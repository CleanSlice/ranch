import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { IFileGateway } from './domain';
import { SaveFileDto } from './dtos';

@ApiTags('files')
@Controller('agents/:agentId/files')
export class FileController {
  constructor(
    private agentGateway: IAgentGateway,
    private fileGateway: IFileGateway,
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

  private async assertAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }
}
