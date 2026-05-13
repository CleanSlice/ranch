import {
  Body,
  Controller,
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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { IAgentGateway } from '#/agent/agent/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IFileGateway } from './domain';
import {
  FileChunkDto,
  ReadFileQueryDto,
  SaveFileDto,
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

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Ask the agent runtime to push its local files to S3, then return the latest S3 state to the admin UI',
  })
  async sync(@Param('agentId') agentId: string): Promise<SyncFilesDto> {
    await this.assertAgent(agentId);
    const result = await this.bridleGateway.syncAgent(agentId);
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
