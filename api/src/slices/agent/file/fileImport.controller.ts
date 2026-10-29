import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { refuseAgentWrite } from './domain/agentTokenGuard';

type AuthedRequest = Request & { user?: IAuthTokenPayload };
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { IAgentGateway } from '#/agent/agent/domain';
import { IFileGateway } from './domain/file.gateway';
import {
  IMPORT_MAX_ARCHIVE_BYTES,
  IMPORT_MAX_FILES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_STAGE_TTL_MIN,
} from './domain/file.limits';
import {
  IImportPlan,
  IImportResult,
  IImportStageMeta,
  IImportTarget,
  ImportMode,
} from './domain/import.types';
import {
  buildFilesZip,
  expectedEtags,
  normaliseTargetFolder,
  resolveSelectedFiles,
  toArchiveEntries,
  validateTargets,
} from './domain/selectedFiles';
import { WorkspaceArchiveService } from './domain/workspaceArchive.service';
import {
  ImportApplyDto,
  ImportPlanDto,
  ImportPlanQueryDto,
  ImportRemoveConflictDto,
  ImportResolveRequestDto,
  ImportResolveResponseDto,
  ImportResultDto,
  ImportStageFilesDto,
} from './dtos';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Whole-workspace import (CLEAN-112, research R4): the archive is uploaded
 * once and staged in S3; preview and apply both work from the stage, so a
 * 100 MB archive never travels twice and the agent tool can stage from an
 * attachment or a URL into the same place.
 */
@ApiTags('files')
@Controller('agents/:agentId/files/import')
export class FileImportController {
  /** One import at a time per agent — a second one answers 409. */
  private readonly running = new Set<string>();

  constructor(
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agentGateway: IAgentGateway,
    private readonly fileGateway: IFileGateway,
    private readonly archives: WorkspaceArchiveService,
  ) {}

  @Post('stage')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'stageAgentImport',
    summary:
      'Upload and validate a workspace archive. Stages it once and returns the merge plan (add / change / unchanged / skip) — nothing is written to the workspace.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { archive: { type: 'string', format: 'binary' } },
      required: ['archive'],
    },
  })
  @ApiOkResponse({ type: ImportPlanDto })
  @ApiResponse({
    status: 400,
    description: 'Archive refused; the message names the entry or limit.',
  })
  @ApiResponse({
    status: 409,
    description: 'An import for this agent is already running.',
  })
  @ApiResponse({ status: 413, description: 'Archive over the size limit.' })
  @UseInterceptors(
    FileInterceptor('archive', {
      limits: { fileSize: IMPORT_MAX_ARCHIVE_BYTES },
    }),
  )
  async stage(
    @Param('agentId') agentId: string,
    @UploadedFile() archive: UploadedFileLike | undefined,
    @Req() req: AuthedRequest,
  ): Promise<ImportPlanDto> {
    refuseAgentWrite(req);
    await this.assertAgent(agentId);
    this.assertNotRunning(agentId);
    const zip = this.requireZip(archive);

    // Housekeeping rides on the write path: no scheduler needed, and a
    // stage nobody applied is gone within an hour of the next upload.
    await this.fileGateway
      .sweepStages(IMPORT_STAGE_TTL_MIN)
      .catch(() => undefined);

    const { entries, wrapperStripped } = await this.archives.validate(zip);
    const importId = randomUUID();
    await this.fileGateway.putStage(agentId, importId, zip, {
      agentId,
      source: 'upload',
      size: zip.length,
      entries: entries.length,
      createdAt: new Date(),
    });
    return this.archives.plan(
      agentId,
      entries,
      { mode: 'merge', includeSessions: false },
      { importId, wrapperStripped },
    );
  }

  // ── Selected files (CLEAN-192) ──────────────────────────────────

  @Post('resolve')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'resolveAgentImportFiles',
    summary:
      'Match selected file names against the workspace: unique / none / ambiguous per name. No upload, nothing written.',
  })
  @ApiOkResponse({ type: ImportResolveResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'A name holds a separator or control character, two names are equal, too many names, or the target folder is not a relative workspace path.',
  })
  async resolve(
    @Param('agentId') agentId: string,
    @Body() body: ImportResolveRequestDto,
    @Req() req: AuthedRequest,
  ): Promise<ImportResolveResponseDto> {
    refuseAgentWrite(req);
    await this.assertAgent(agentId);
    const targetFolder = normaliseTargetFolder(body.targetFolder);
    const existing = await this.fileGateway.listWithEtags(agentId);
    return {
      targetFolder,
      rows: resolveSelectedFiles(body.names, targetFolder, existing),
    };
  }

  @Post('stage-files')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'stageAgentImportFiles',
    summary:
      'Upload selected plain files with their resolved targets. Stages them once (kind: files) and returns the merge plan — nothing is written. Apply with applyAgentImport in merge mode.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        targets: { type: 'string' },
        targetFolder: { type: 'string' },
      },
      required: ['files', 'targets'],
    },
  })
  @ApiOkResponse({ type: ImportPlanDto })
  @ApiResponse({
    status: 400,
    description:
      'Duplicate name, a target outside the resolved set, an unsafe path, or no files.',
  })
  @ApiResponse({
    status: 409,
    description: 'An import for this agent is already running.',
  })
  @ApiResponse({
    status: 413,
    description: 'A file over the per-file limit, or too many files.',
  })
  @UseInterceptors(
    FilesInterceptor('files', IMPORT_MAX_FILES, {
      limits: { fileSize: IMPORT_MAX_FILE_BYTES },
    }),
  )
  async stageFiles(
    @Param('agentId') agentId: string,
    @UploadedFiles() files: UploadedFileLike[] | undefined,
    @Body() body: ImportStageFilesDto,
    @Req() req: AuthedRequest,
  ): Promise<ImportPlanDto> {
    refuseAgentWrite(req);
    await this.assertAgent(agentId);
    this.assertNotRunning(agentId);

    const uploaded = (files ?? []).filter((f) => f && f.buffer);
    if (uploaded.length === 0) {
      throw new BadRequestException('files: at least one file is required');
    }
    if (uploaded.length > IMPORT_MAX_FILES) {
      throw new PayloadTooLargeException(
        `files: too many files (${uploaded.length} > ${IMPORT_MAX_FILES})`,
      );
    }
    for (const f of uploaded) {
      if (f.buffer.length > IMPORT_MAX_FILE_BYTES) {
        throw new PayloadTooLargeException(
          `files: ${f.originalname} exceeds ${IMPORT_MAX_FILE_BYTES} bytes`,
        );
      }
    }
    const targets = this.parseTargets(body.targets);
    const targetFolder = normaliseTargetFolder(body.targetFolder);

    await this.fileGateway
      .sweepStages(IMPORT_STAGE_TTL_MIN)
      .catch(() => undefined);

    // Re-resolve server-side: the rule is the API's, whatever the client sent.
    const existing = await this.fileGateway.listWithEtags(agentId);
    const names = uploaded.map((f) => f.originalname);
    const rows = resolveSelectedFiles(names, targetFolder, existing);
    const paths = validateTargets(targets, rows, targetFolder);
    const entries = toArchiveEntries(
      uploaded.map((f) => ({ name: f.originalname, bytes: f.buffer })),
      paths,
    );

    const zip = await buildFilesZip(entries);
    const importId = randomUUID();
    await this.fileGateway.putStage(agentId, importId, zip, {
      agentId,
      source: 'upload',
      size: zip.length,
      entries: entries.length,
      createdAt: new Date(),
      kind: 'files',
      expected: expectedEtags(entries, existing),
    });
    return this.archives.plan(
      agentId,
      entries,
      { mode: 'merge', includeSessions: false },
      { importId, wrapperStripped: null },
    );
  }

  private parseTargets(raw: string | undefined): IImportTarget[] {
    if (!raw) throw new BadRequestException('targets: required');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('targets: not valid JSON');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('targets: must be an array');
    }
    return parsed as IImportTarget[];
  }

  @Get(':importId/plan')
  @ApiOperation({
    operationId: 'planAgentImport',
    summary: 'Re-plan a staged archive with a mode and the sessions option.',
  })
  @ApiOkResponse({ type: ImportPlanDto })
  @ApiResponse({ status: 404, description: 'Stage expired or unknown.' })
  async plan(
    @Param('agentId') agentId: string,
    @Param('importId') importId: string,
    @Query() query: ImportPlanQueryDto,
  ): Promise<ImportPlanDto> {
    await this.assertAgent(agentId);
    const { entries, wrapperStripped, meta } = await this.loadStage(
      agentId,
      importId,
    );
    const mode = query.mode ?? 'merge';
    this.assertModeForStage(meta, mode);
    return this.archives.plan(
      agentId,
      entries,
      {
        mode,
        includeSessions: query.includeSessions === true,
      },
      { importId, wrapperStripped },
    );
  }

  @Post(':importId/apply')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'applyAgentImport',
    summary:
      'Apply a staged archive. Replace mode that would remove files needs `confirmRemove`. Answers 409 while another import runs for the agent.',
  })
  @ApiOkResponse({ type: ImportResultDto })
  @ApiResponse({ status: 409, type: ImportRemoveConflictDto })
  async apply(
    @Param('agentId') agentId: string,
    @Param('importId') importId: string,
    @Body() body: ImportApplyDto,
    @Req() req: AuthedRequest,
  ): Promise<ImportResultDto> {
    refuseAgentWrite(req);
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    this.assertNotRunning(agentId);

    const { entries, wrapperStripped, meta } = await this.loadStage(
      agentId,
      importId,
    );
    const mode: ImportMode = body.mode;
    this.assertModeForStage(meta, mode);
    const includeSessions = body.includeSessions === true;
    const plan: IImportPlan = await this.archives.plan(
      agentId,
      entries,
      { mode, includeSessions },
      { importId, wrapperStripped },
    );
    if (mode === 'replace' && plan.counts.remove > 0 && !body.confirmRemove) {
      throw new HttpException(
        { requiresConfirmation: true, remove: plan.counts.remove },
        HttpStatus.CONFLICT,
      );
    }

    this.running.add(agentId);
    let result: IImportResult;
    try {
      result = await this.archives.apply(
        agentId,
        entries,
        plan,
        meta.kind === 'files' ? meta.expected : undefined,
      );
    } finally {
      this.running.delete(agentId);
    }
    await this.fileGateway
      .deleteStage(agentId, importId)
      .catch(() => undefined);

    return {
      ...result,
      restartRequired: agent.status === 'running',
    };
  }

  private async loadStage(
    agentId: string,
    importId: string,
  ): Promise<{
    entries: Awaited<
      ReturnType<WorkspaceArchiveService['validate']>
    >['entries'];
    wrapperStripped: string | null;
    meta: IImportStageMeta;
  }> {
    const stage = await this.fileGateway.getStage(agentId, importId);
    if (!stage || stage.meta.agentId !== agentId) {
      throw new NotFoundException('Import stage expired or unknown');
    }
    // A files stage holds paths the operator chose; never strip a "wrapper".
    const validated = await this.archives.validate(stage.zip, {
      stripWrapper: stage.meta.kind !== 'files',
    });
    return { ...validated, meta: stage.meta };
  }

  /** Selected files never remove anything (CLEAN-192 FR-010). */
  private assertModeForStage(meta: IImportStageMeta, mode: ImportMode): void {
    if (meta.kind === 'files' && mode !== 'merge') {
      throw new BadRequestException(
        'Selected files never remove anything; use a workspace archive for replace.',
      );
    }
  }

  private requireZip(file: UploadedFileLike | undefined): Buffer {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('archive: a zip file is required');
    }
    if (file.size > IMPORT_MAX_ARCHIVE_BYTES) {
      throw new PayloadTooLargeException(
        `archive: exceeds ${IMPORT_MAX_ARCHIVE_BYTES} bytes`,
      );
    }
    return file.buffer;
  }

  private assertNotRunning(agentId: string): void {
    if (this.running.has(agentId)) {
      throw new ConflictException(
        'An import for this agent is already running',
      );
    }
  }

  private async assertAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }
}
