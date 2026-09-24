import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  forwardRef,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { refuseAgentWrite } from './domain/agentTokenGuard';

type AuthedRequest = Request & { user?: IAuthTokenPayload };
import { IAgentGateway } from '#/agent/agent/domain';
import { IBridleGateway } from '#/bridle/domain';
import { Public } from '#/user/auth/guards';
import { IFileGateway, OpenLinkService, SyncGuardService } from './domain';
import { RANGE_BYTES, fileLimits } from './domain/file.limits';
import { TEXT_EXTENSIONS, kindFromPath } from './domain/fileKind';
import { rawResponseHeaders } from './domain/rawHeaders';
import {
  DeleteFileQueryDto,
  DeleteFilesBodyDto,
  DeleteFilesConflictDto,
  DeleteFilesDto,
  ExportFilesBodyDto,
  FileChunkDto,
  FileContentDto,
  FileLimitsDto,
  FileNodeDto,
  OpenLinkBodyDto,
  OpenLinkDto,
  ReadFileQueryDto,
  SaveFileDto,
  SyncConflictDto,
  SyncFilesBodyDto,
  SyncFilesDto,
} from './dtos';

@ApiTags('files')
@Controller('agents/:agentId/files')
export class FileController {
  constructor(
    @Inject(forwardRef(() => IAgentGateway))
    private agentGateway: IAgentGateway,
    private fileGateway: IFileGateway,
    @Inject(forwardRef(() => IBridleGateway))
    private bridleGateway: IBridleGateway,
    private syncGuard: SyncGuardService,
    private openLinks: OpenLinkService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List files for an agent. Each node says whether it is text or binary and whether it can be edited in place.',
  })
  @ApiOkResponse({ type: [FileNodeDto] })
  async list(@Param('agentId') agentId: string): Promise<FileNodeDto[]> {
    await this.assertAgent(agentId);
    const nodes = await this.fileGateway.list(agentId);
    return nodes.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() }));
  }

  @Get('limits')
  @ApiOperation({
    summary:
      'Effective limits of the file slice (editable size, slice size, import and diff caps, text formats). Clients never hardcode these.',
  })
  @ApiOkResponse({ type: FileLimitsDto })
  async limits(@Param('agentId') agentId: string): Promise<FileLimitsDto> {
    await this.assertAgent(agentId);
    return fileLimits(TEXT_EXTENSIONS);
  }

  @Get('content')
  @ApiOperation({
    summary:
      'Read a slice of a text file. Omit `offset`/`limit` to read the first 256 KB; the slice never ends mid-character. Use the returned `nextOffset` to continue. Binary files are refused (400) — use export or an open link.',
  })
  @ApiOkResponse({ type: FileChunkDto })
  async read(
    @Param('agentId') agentId: string,
    @Query() query: ReadFileQueryDto,
  ): Promise<FileChunkDto> {
    await this.assertAgent(agentId);
    const chunk = await this.fileGateway.readRange(
      agentId,
      query.path,
      query.offset ?? 0,
      query.limit ?? RANGE_BYTES,
    );
    return {
      ...chunk,
      updatedAt: chunk.updatedAt.toISOString(),
    };
  }

  @Put('content')
  @ApiOperation({
    summary:
      'Save a text file (any recognised text format; `.json` must parse). `createOnly` answers 409 when the file exists; `ifUnmodifiedSince` answers 412 when the stored file is newer.',
  })
  @ApiOkResponse({ type: FileContentDto })
  async save(
    @Param('agentId') agentId: string,
    @Query('path') path: string,
    @Body() dto: SaveFileDto,
    @Req() req: AuthedRequest,
  ): Promise<FileContentDto> {
    refuseAgentWrite(req);
    await this.assertAgent(agentId);
    await this.fileGateway.save(agentId, path, dto.content, {
      createOnly: dto.createOnly,
      ifUnmodifiedSince: dto.ifUnmodifiedSince
        ? new Date(dto.ifUnmodifiedSince)
        : undefined,
    });
    const saved = await this.fileGateway.read(agentId, path);
    return { ...saved, updatedAt: saved.updatedAt.toISOString() };
  }

  @Delete('content')
  @ApiOperation({
    summary:
      'Delete a file, or a whole folder (e.g. a skill dir) when `recursive=true`. Template-managed skills are recreated on the next restart unless detached from the template first.',
  })
  @ApiOkResponse({ type: DeleteFilesDto })
  async delete(
    @Param('agentId') agentId: string,
    @Query() query: DeleteFileQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<DeleteFilesDto> {
    refuseAgentWrite(req);
    await this.assertAgent(agentId);
    if (query.recursive) {
      const deleted = await this.fileGateway.deletePrefix(agentId, query.path);
      return { deleted };
    }
    await this.fileGateway.delete(agentId, query.path);
    return { deleted: 1 };
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'deleteAgentFileSelection',
    summary:
      'Delete a selection of files and folders. Answers 409 (and deletes nothing) when the selection would empty the workspace, unless `confirm` is set.',
  })
  @ApiOkResponse({ type: DeleteFilesDto })
  @ApiResponse({ status: 409, type: DeleteFilesConflictDto })
  async deleteSelection(
    @Param('agentId') agentId: string,
    @Body() body: DeleteFilesBodyDto,
    @Req() req: AuthedRequest,
  ): Promise<DeleteFilesDto> {
    refuseAgentWrite(req);
    await this.assertAgent(agentId);
    const all = await this.fileGateway.list(agentId);
    const wanted = body.paths;
    const covered = (p: string): boolean =>
      wanted.some(
        (w) => p === w || p.startsWith(w.endsWith('/') ? w : w + '/'),
      );
    const wouldRemove = all.filter((n) => covered(n.path)).length;
    if (wouldRemove > 0 && wouldRemove >= all.length && !body.confirm) {
      throw new HttpException(
        { requiresConfirmation: true, wouldRemove, total: all.length },
        HttpStatus.CONFLICT,
      );
    }
    let deleted = 0;
    const files = new Set(all.map((n) => n.path));
    for (const p of wanted) {
      if (files.has(p)) {
        await this.fileGateway.delete(agentId, p);
        deleted += 1;
      } else {
        deleted += await this.fileGateway.deletePrefix(agentId, p);
      }
    }
    return { deleted };
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Ask the agent runtime to push its local files to S3. Answers 409 with ' +
      'the at-risk file list (and does NOT sync) when S3 holds edits newer ' +
      'than the pod’s last pull/push, unless `confirm` is set.',
  })
  @ApiResponse({
    status: 409,
    type: SyncConflictDto,
    description:
      'S3 files newer than the pod’s working copy were found and confirm was ' +
      'not set. No sync was performed.',
  })
  async sync(
    @Param('agentId') agentId: string,
    @Body() body?: SyncFilesBodyDto,
  ): Promise<SyncFilesDto> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    // Guard (CLEAN-50): the pod pushes its delta over S3 and never checks S3
    // freshness, so anything edited in S3 since the pod's last pull/push can
    // be silently overwritten or deleted. Surface the risk and require an
    // explicit confirm instead. `confirm` skips the check — the operator
    // already saw and accepted the list.
    if (!body?.confirm) {
      const { baseline, atRisk } = await this.syncGuard.assess(
        agentId,
        agent.lastPullAt,
        agent.lastSyncAt,
      );
      if (baseline && atRisk.length > 0) {
        throw new HttpException(
          {
            requiresConfirmation: true,
            atRisk: atRisk.map((n) => ({
              path: n.path,
              updatedAt: n.updatedAt.toISOString(),
            })),
            baseline: baseline.toISOString(),
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    const result = await this.bridleGateway.syncAgent(agentId);
    // Marker for the next conflict check: the pod's S3 writes are complete
    // once sync_done resolved the gateway promise. Offline sync did nothing,
    // so it must not advance the baseline.
    if (result.agentOnline) {
      await this.agentGateway.setLastSyncAt(agentId);
    }
    return { agentOnline: result.agentOnline, pushed: result.pushed };
  }

  // Using @Res() bypasses the global ResponseInterceptor envelope so the
  // browser receives raw bytes (not `{success, data}` wrapping the zip).
  @Get('export')
  @ApiOperation({
    operationId: 'exportAgentFiles',
    summary:
      'Download a ZIP archive of the agent’s entire S3 prefix (files, skills, runtime state). Used as a safety net before destructive actions.',
  })
  async exportZip(
    @Param('agentId') agentId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertAgent(agentId);
    const { filename, buffer } = await this.fileGateway.exportZip(agentId);
    this.sendZip(res, filename, buffer);
  }

  @Post('export')
  @ApiOperation({
    operationId: 'exportAgentFileSelection',
    summary:
      'Download a ZIP of a selection: files, or folders by prefix. Omit `paths` for the whole workspace.',
  })
  async exportSelection(
    @Param('agentId') agentId: string,
    @Body() body: ExportFilesBodyDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertAgent(agentId);
    const { filename, buffer } = await this.fileGateway.exportZip(
      agentId,
      body.paths,
    );
    this.sendZip(res, filename, buffer);
  }

  @Post('open-link')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'mintAgentFileOpenLink',
    summary:
      'Mint a short-lived, credential-free link to the raw stored file ("Open full"). Text opens inline in a new tab; binary downloads. Expires after the configured lifetime (see /files/limits).',
  })
  @ApiOkResponse({ type: OpenLinkDto })
  async openLink(
    @Param('agentId') agentId: string,
    @Body() body: OpenLinkBodyDto,
  ): Promise<OpenLinkDto> {
    await this.assertAgent(agentId);
    // The kind in the token only picks headers; the raw route re-checks
    // the stored object. An unknown extension is treated as text so it
    // opens inline, which is what "Open full" is for.
    const guess = kindFromPath(body.path);
    const kind = guess === 'binary' ? 'binary' : 'text';
    const { token, expiresAt } = this.openLinks.mint(agentId, body.path, kind);
    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    return {
      url: `${base}/agents/${encodeURIComponent(agentId)}/files/raw?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // The token is the whole credential: no session, so the link works in a
  // fresh tab. @Res() bypasses the JSON envelope — this streams bytes.
  @Get('raw')
  @Public()
  @ApiOperation({
    operationId: 'readAgentFileRaw',
    summary:
      'Stream the raw stored file for an open link. 401 when the token is invalid, expired or minted for another agent; 404 (plain text) when the file is gone.',
  })
  async raw(
    @Param('agentId') agentId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    let claims;
    try {
      claims = this.openLinks.verify(token ?? '');
    } catch {
      res
        .status(401)
        .type('text/plain')
        .send('Open link is invalid or has expired');
      return;
    }
    if (claims.agentId !== agentId) {
      res.status(401).type('text/plain').send('Open link is invalid');
      return;
    }
    let stream;
    try {
      stream = await this.fileGateway.streamRaw(agentId, claims.path);
    } catch (err) {
      if (err instanceof NotFoundException) {
        res.status(404).type('text/plain').send('File not found');
        return;
      }
      throw err;
    }
    for (const [name, value] of Object.entries(
      rawResponseHeaders(
        claims.path,
        stream.kind,
        stream.contentType,
        stream.size,
      ),
    )) {
      res.setHeader(name, value);
    }
    stream.body.pipe(res);
  }

  private sendZip(res: Response, filename: string, buffer: Buffer): void {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  private async assertAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }
}
