import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '#/user/auth/guards';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { KnowledgeService } from '#/reins/knowledge/domain';
import { ISourceGateway } from '#/reins/source/domain';
import { S3Repository } from '#/aws/s3';
import { IFileGateway } from '#/agent/file/domain';
import { RlmJobGuard } from './guards/rlmJob.guard';

// Reins sources are meant to be reasoned over whole, not chunked - but an
// operator could still attach a multi-hundred-MB file. Cap what a single
// RLM run will pull into API process memory; larger sources need the v2
// text-extraction pipeline (see Decision C in the design doc) anyway.
const MAX_SOURCE_FETCH_BYTES = 2 * 1024 * 1024;
const TEXT_LIKE_MIME_PREFIXES = ['text/'];
const TEXT_LIKE_MIME_EXACT = new Set([
  'application/json',
  'application/x-ndjson',
]);

function assertTextLikeMime(mimeType: string | null): void {
  const mime = (mimeType ?? '').toLowerCase();
  const isTextLike =
    TEXT_LIKE_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
    TEXT_LIKE_MIME_EXACT.has(mime);
  if (!isTextLike) {
    throw new BadRequestException(
      `RLM can't extract text from "${mimeType ?? 'unknown'}" yet - only text-shaped formats are supported in v1.`,
    );
  }
}

function sliceRange(
  content: string,
  offset: number,
  limit: number,
): { content: string; totalSize: number; hasMore: boolean } {
  const totalSize = Buffer.byteLength(content, 'utf-8');
  const buf = Buffer.from(content, 'utf-8');
  const safeOffset = Math.max(0, Math.floor(offset || 0));
  const safeLimit = Math.max(1, Math.floor(limit || 65536));
  const slice = buf.subarray(safeOffset, safeOffset + safeLimit);
  return {
    content: slice.toString('utf-8'),
    totalSize,
    hasMore: safeOffset + slice.length < totalSize,
  };
}

function parseIntParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Internal-only context-read endpoints for the RLM executor job pod - never
 * called by agents or browsers directly. Guarded by RlmJobGuard, which
 * re-validates every request against the caller token's embedded scope
 * (no server-side job registry - see AuthService.issueRlmJobToken).
 */
@ApiExcludeController()
@Controller('rlm/internal/context')
@UseGuards(JwtAuthGuard, RlmJobGuard)
export class RlmInternalController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly sourceGateway: ISourceGateway,
    private readonly s3: S3Repository,
    private readonly fileGateway: IFileGateway,
  ) {}

  @Get('knowledge/:knowledgeId/query')
  async queryKnowledge(
    @Param('knowledgeId') knowledgeId: string,
    @Query('query') query: string,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ) {
    this.assertKnowledgeInScope(req, knowledgeId);
    if (!query) throw new BadRequestException('query is required');
    return this.knowledgeService.query(knowledgeId, query);
  }

  @Get('source/:sourceId/range')
  async readSourceRange(
    @Param('sourceId') sourceId: string,
    @Query('offset') offsetRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ) {
    this.assertSourceInScope(req, sourceId);
    const source = await this.sourceGateway.findById(sourceId);
    if (!source) throw new NotFoundException('Source not found');

    const offset = parseIntParam(offsetRaw, 0);
    const limit = parseIntParam(limitRaw, 65536);

    if (source.type === 'text') {
      const { content, totalSize, hasMore } = sliceRange(
        source.content ?? '',
        offset,
        limit,
      );
      return { content, totalSize, offset, hasMore };
    }

    // file / url sources: only ever persisted as an S3 pointer - fetch the
    // whole object (capped) and slice in memory. No true byte-range GET
    // here because these are expected to be small text-shaped documents
    // (see assertTextLikeMime) - a real streaming Range read is only worth
    // building alongside the v2 document-extraction pipeline.
    assertTextLikeMime(source.mimeType);
    if (!source.url) {
      throw new BadRequestException(`Source ${sourceId} has no stored file`);
    }
    if ((source.sizeBytes ?? 0) > MAX_SOURCE_FETCH_BYTES) {
      throw new BadRequestException(
        `Source ${sourceId} is too large for RLM v1 (${source.sizeBytes} > ${MAX_SOURCE_FETCH_BYTES} bytes)`,
      );
    }
    const location = S3Repository.parseUri(source.url);
    const buffer = await this.s3.download(location);
    const { content, totalSize, hasMore } = sliceRange(
      buffer.toString('utf-8'),
      offset,
      limit,
    );
    return { content, totalSize, offset, hasMore };
  }

  @Get('agent-file/:agentId/range')
  async readAgentFileRange(
    @Param('agentId') agentId: string,
    @Query('path') path: string,
    @Query('offset') offsetRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ) {
    this.assertAgentFileInScope(req, agentId, path);
    const offset = parseIntParam(offsetRaw, 0);
    const limit = parseIntParam(limitRaw, 262144);
    return this.fileGateway.readRange(agentId, path, offset, limit);
  }

  private scope(req: Request & { user?: IAuthTokenPayload }) {
    // RlmJobGuard already asserted req.user.rlmScope exists.
    return req.user!.rlmScope!;
  }

  private assertKnowledgeInScope(
    req: Request & { user?: IAuthTokenPayload },
    knowledgeId: string,
  ): void {
    if (!this.scope(req).knowledgeIds.includes(knowledgeId)) {
      throw new ForbiddenException(
        `Knowledge ${knowledgeId} is not in this job's scope`,
      );
    }
  }

  private assertSourceInScope(
    req: Request & { user?: IAuthTokenPayload },
    sourceId: string,
  ): void {
    if (!this.scope(req).sourceIds.includes(sourceId)) {
      throw new ForbiddenException(
        `Source ${sourceId} is not in this job's scope`,
      );
    }
  }

  private assertAgentFileInScope(
    req: Request & { user?: IAuthTokenPayload },
    agentId: string,
    path: string,
  ): void {
    const scope = this.scope(req);
    if (agentId !== scope.agentId) {
      throw new ForbiddenException(
        "This job can't read another agent's files",
      );
    }
    if (!path || !path.startsWith(scope.filePrefix)) {
      throw new ForbiddenException(
        `Path must start with "${scope.filePrefix}"`,
      );
    }
  }
}
