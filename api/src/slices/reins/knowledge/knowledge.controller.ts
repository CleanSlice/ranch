import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { KnowledgeService } from './domain/knowledge.service';
import { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';
import { IGraphData } from './domain/knowledge.types';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  QueryKnowledgeDto,
  GetGraphDto,
  GraphDto,
  KnowledgeQueryResultDto,
} from './dtos';

@ApiTags('knowledges')
@Controller('knowledges')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
  ) {}

  private async requireEnabled(): Promise<void> {
    if (!(await this.knowledgeConfig.isEnabled())) {
      throw new ServiceUnavailableException(
        'Knowledge service is not configured',
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'List knowledges', operationId: 'getKnowledges' })
  async list() {
    if (!(await this.knowledgeConfig.isEnabled())) return [];
    return this.service.list();
  }

  @Get('status')
  @ApiOperation({
    summary: 'Knowledge service availability',
    operationId: 'getKnowledgeStatus',
  })
  async status(): Promise<{ enabled: boolean }> {
    return { enabled: await this.knowledgeConfig.isEnabled() };
  }

  @Get('graph/labels')
  @ApiOperation({
    summary: 'List graph entity labels',
    operationId: 'getGraphLabels',
  })
  async graphLabels(): Promise<string[]> {
    await this.requireEnabled();
    return this.service.getGraphLabels();
  }

  @Get('graph')
  @ApiOperation({ summary: 'Get knowledge graph', operationId: 'getGraph' })
  @ApiOkResponse({ type: GraphDto })
  async graph(@Query() dto: GetGraphDto): Promise<IGraphData> {
    await this.requireEnabled();
    return this.service.getGraph({
      label: dto.label,
      maxDepth: dto.maxDepth,
      maxNodes: dto.maxNodes,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one knowledge', operationId: 'getKnowledge' })
  async getOne(@Param('id') id: string) {
    await this.requireEnabled();
    return this.service.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create knowledge', operationId: 'createKnowledge' })
  async create(@Body() dto: CreateKnowledgeDto) {
    await this.requireEnabled();
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update knowledge', operationId: 'updateKnowledge' })
  async update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDto) {
    await this.requireEnabled();
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete knowledge', operationId: 'deleteKnowledge' })
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.requireEnabled();
    await this.service.delete(id);
  }

  @Post(':id/index')
  @ApiOperation({ summary: 'Start indexing', operationId: 'indexKnowledge' })
  @HttpCode(202)
  async startIndex(@Param('id') id: string) {
    await this.requireEnabled();
    await this.service.startIndex(id);
    return { ok: true };
  }

  @Post(':id/query')
  @ApiOperation({
    summary: 'Query knowledge (LLM-generated answer)',
    operationId: 'queryKnowledge',
  })
  @ApiOkResponse({ type: KnowledgeQueryResultDto })
  async query(@Param('id') id: string, @Body() dto: QueryKnowledgeDto) {
    await this.requireEnabled();
    return this.service.query(id, dto.query, dto.mode, dto.topK);
  }
}
