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
  forwardRef,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { IBridleGateway } from '#/bridle/domain';
import { IFileGateway } from './domain';
import { SaveFileDto, SyncFilesDto } from './dtos';

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
  @ApiOperation({ summary: 'Read a file' })
  async read(@Param('agentId') agentId: string, @Query('path') path: string) {
    await this.assertAgent(agentId);
    return this.fileGateway.read(agentId, path);
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
      "Ask the agent runtime to push its local files to S3, then return the latest S3 state to the admin UI",
  })
  async sync(@Param('agentId') agentId: string): Promise<SyncFilesDto> {
    await this.assertAgent(agentId);
    const result = await this.bridleGateway.syncAgent(agentId);
    return { agentOnline: result.agentOnline, pushed: result.pushed };
  }

  private async assertAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }
}
