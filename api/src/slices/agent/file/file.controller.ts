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
  Res,
  forwardRef,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { HttpException, HttpStatus } from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IFileGateway, SyncGuardService } from './domain';
import {
  DeleteFileQueryDto,
  DeleteFilesDto,
  FileChunkDto,
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'List files for an agent' })
  async list(@Param('agentId') agentId: string) {
    await this.assertAgent(agentId);
    return this.fileGateway.list(agentId);
  }

  @Get('content')
  @ApiOperation({
    summary:
      'Read a chunk of a file. Omit `offset`/`limit` to read the first 256 KB. Use the returned `nextOffset` to continue.',
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
      query.limit ?? 256 * 1024,
    );
    return {
      ...chunk,
      updatedAt: chunk.updatedAt.toISOString(),
    };
  }

  @Put('content')
  @ApiOperation({ summary: 'Save a file (.md / .json only)' })
  async save(
    @Param('agentId') agentId: string,
    @Query('path') path: string,
    @Body() dto: SaveFileDto,
  ) {
    await this.assertAgent(agentId);
    await this.fileGateway.save(agentId, path, dto.content);
    return this.fileGateway.read(agentId, path);
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
  ): Promise<DeleteFilesDto> {
    await this.assertAgent(agentId);
    if (query.recursive) {
      const deleted = await this.fileGateway.deletePrefix(agentId, query.path);
      return { deleted };
    }
    await this.fileGateway.delete(agentId, query.path);
    return { deleted: 1 };
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
