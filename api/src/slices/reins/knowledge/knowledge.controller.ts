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
import { ILightragClient } from '../lightrag/domain/lightrag.client';
import { ILlmGateway } from '#/llm/domain';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  FilterKnowledgeDto,
  KnowledgePageDto,
  QueryKnowledgeDto,
  GetGraphDto,
  GetGraphLabelsDto,
  GraphDto,
  GraphLabelsDto,
  KnowledgeQueryResultDto,
} from './dtos';

@ApiTags('knowledges')
@Controller('knowledges')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
    private readonly lightrag: ILightragClient,
    private readonly llm: ILlmGateway,
  ) {}

  private async requireEnabled(): Promise<void> {
    if (!(await this.knowledgeConfig.isEnabled())) {
      throw new ServiceUnavailableException(
        'Knowledge service is not configured',
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List knowledges (searchable, paged)',
    operationId: 'getKnowledges',
  })
  @ApiOkResponse({ type: KnowledgePageDto })
  async list(@Query() dto: FilterKnowledgeDto): Promise<KnowledgePageDto> {
    if (!(await this.knowledgeConfig.isEnabled())) {
      return { items: [], total: 0, page: 1, perPage: dto.perPage ?? 50 };
    }
    return this.service.listPage({
      search: dto.search,
      page: dto.page,
      perPage: dto.perPage,
    });
  }

  @Get('status')
  @ApiOperation({
    summary: 'Knowledge service availability and setup readiness',
    operationId: 'getKnowledgeStatus',
  })
  async status(): Promise<{
    enabled: boolean;
    setup: {
      hasChatCredential: boolean;
      hasEmbeddingCredential: boolean;
      hasUrl: boolean;
      hasBucket: boolean;
      hasCredentialsSelected: boolean;
      isHealthy: boolean;
    };
  }> {
    const [config, selected, hasChat, hasEmbedding] = await Promise.all([
      this.knowledgeConfig.resolve(),
      this.knowledgeConfig.getSelectedCredentialIds(),
      this.llm.hasCredentialWithCapability('chat'),
      this.llm.hasCredentialWithCapability('embedding'),
    ]);

    let isHealthy = false;
    if (config.url.length > 0) {
      try {
        await this.lightrag.health();
        isHealthy = true;
      } catch {
        isHealthy = false;
      }
    }

    return {
      enabled: config.enabled,
      setup: {
        hasChatCredential: hasChat,
        hasEmbeddingCredential: hasEmbedding,
        hasUrl: config.url.length > 0,
        hasBucket: config.bucket.length > 0,
        hasCredentialsSelected:
          selected.chat !== null && selected.embedding !== null,
        isHealthy,
      },
    };
  }

  @Get(':id/graph/labels')
  @ApiOperation({
    summary: 'List entity labels of one knowledge base',
    operationId: 'getGraphLabels',
  })
  @ApiOkResponse({ type: GraphLabelsDto })
  async graphLabels(
    @Param('id') id: string,
    @Query() dto: GetGraphLabelsDto,
  ): Promise<GraphLabelsDto> {
    await this.requireEnabled();
    return this.service.getGraphLabels(id, {
      search: dto.search,
      limit: dto.limit,
    });
  }

  @Get(':id/graph')
  @ApiOperation({
    summary: 'Get the graph of one knowledge base',
    operationId: 'getGraph',
  })
  @ApiOkResponse({ type: GraphDto })
  async graph(
    @Param('id') id: string,
    @Query() dto: GetGraphDto,
  ): Promise<IGraphData> {
    await this.requireEnabled();
    return this.service.getGraph(id, {
      label: dto.label,
      maxDepth: dto.maxDepth,
      maxNodes: dto.maxNodes,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one knowledge', operationId: 'getKnowledge' })
  async getOne(@Param('id') id: string) {
    await this.requireEnabled();
    return this.service.getWithDerivedStatus(id);
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
