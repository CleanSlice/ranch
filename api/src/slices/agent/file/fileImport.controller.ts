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
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  IMPORT_STAGE_TTL_MIN,
} from './domain/file.limits';
import { IImportPlan, IImportResult, ImportMode } from './domain/import.types';
import { WorkspaceArchiveService } from './domain/workspaceArchive.service';
import {
  ImportApplyDto,
  ImportPlanDto,
  ImportPlanQueryDto,
  ImportRemoveConflictDto,
  ImportResultDto,
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
  @ApiResponse({ status: 400, description: 'Archive refused; the message names the entry or limit.' })
  @ApiResponse({ status: 409, description: 'An import for this agent is already running.' })
  @ApiResponse({ status: 413, description: 'Archive over the size limit.' })
  @UseInterceptors(
    FileInterceptor('archive', {
      limits: { fileSize: IMPORT_MAX_ARCHIVE_BYTES },
    }),
  )
  async stage(
    @Param('agentId') agentId: string,
    @UploadedFile() archive: UploadedFileLike | undefined,
  ): Promise<ImportPlanDto> {
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
    const { entries, wrapperStripped } = await this.loadStage(agentId, importId);
    return this.archives.plan(
      agentId,
      entries,
      {
        mode: query.mode ?? 'merge',
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
  ): Promise<ImportResultDto> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    this.assertNotRunning(agentId);

    const { entries, wrapperStripped } = await this.loadStage(agentId, importId);
    const mode: ImportMode = body.mode;
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
      result = await this.archives.apply(agentId, entries, plan);
    } finally {
      this.running.delete(agentId);
    }
    await this.fileGateway.deleteStage(agentId, importId).catch(() => undefined);

    return {
      ...result,
      restartRequired: agent.status === 'running',
    };
  }

  private async loadStage(
    agentId: string,
    importId: string,
  ): Promise<{ entries: Awaited<ReturnType<WorkspaceArchiveService['validate']>>['entries']; wrapperStripped: string | null }> {
    const stage = await this.fileGateway.getStage(agentId, importId);
    if (!stage || stage.meta.agentId !== agentId) {
      throw new NotFoundException('Import stage expired or unknown');
    }
    return this.archives.validate(stage.zip);
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
      throw new ConflictException('An import for this agent is already running');
    }
  }

  private async assertAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }
}
