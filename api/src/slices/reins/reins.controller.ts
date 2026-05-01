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
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiOkResponse } from '@nestjs/swagger';
import { ReinsService } from './knowledge/domain/reins.service';
import { IKnowledgeConfigService } from './config/domain/knowledgeConfig.service';
import { IGraphData } from './knowledge/domain/reins.types';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  QueryKnowledgeDto,
  CreateSourceDto,
  GetGraphDto,
  GraphDto,
  KnowledgeQueryResultDto,
} from './knowledge/dtos';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('reins')
@Controller('knowledges')
export class ReinsController {
  constructor(
    private readonly service: ReinsService,
    private readonly knowledgeConfig: IKnowledgeConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List knowledges', operationId: 'getKnowledges' })
  async list() {
    if (!(await this.knowledgeConfig.isEnabled())) return [];
    return this.service.listKnowledge();
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
  graphLabels(): Promise<string[]> {
    return this.service.getGraphLabels();
  }

  @Get('graph')
  @ApiOperation({ summary: 'Get knowledge graph', operationId: 'getGraph' })
  @ApiOkResponse({ type: GraphDto })
  graph(@Query() dto: GetGraphDto): Promise<IGraphData> {
    return this.service.getGraph({
      label: dto.label,
      maxDepth: dto.maxDepth,
      maxNodes: dto.maxNodes,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one knowledge', operationId: 'getKnowledge' })
  getOne(@Param('id') id: string) {
    return this.service.getKnowledge(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create knowledge', operationId: 'createKnowledge' })
  create(@Body() dto: CreateKnowledgeDto) {
    return this.service.createKnowledge(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update knowledge', operationId: 'updateKnowledge' })
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDto) {
    return this.service.updateKnowledge(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete knowledge', operationId: 'deleteKnowledge' })
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.service.deleteKnowledge(id);
  }

  @Post(':id/index')
  @ApiOperation({
    summary: 'Start indexing',
    operationId: 'indexKnowledge',
  })
  @HttpCode(202)
  async startIndex(@Param('id') id: string) {
    await this.service.startIndex(id);
    return { ok: true };
  }

  @Post(':id/query')
  @ApiOperation({
    summary: 'Query knowledge (LLM-generated answer)',
    operationId: 'queryKnowledge',
  })
  @ApiOkResponse({ type: KnowledgeQueryResultDto })
  query(@Param('id') id: string, @Body() dto: QueryKnowledgeDto) {
    return this.service.query(id, dto.query, dto.mode, dto.topK);
  }

  @Get(':id/sources')
  @ApiOperation({
    summary: 'List sources',
    operationId: 'getKnowledgeSources',
  })
  listSources(@Param('id') id: string) {
    return this.service.listSources(id);
  }

  @Post(':id/sources')
  @ApiOperation({
    summary: 'Add source (file|url|text)',
    operationId: 'addKnowledgeSource',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file'))
  addSource(
    @Param('id') id: string,
    @Body() dto: CreateSourceDto,
    @UploadedFile() file?: UploadedFileLike,
  ) {
    if (dto.type === 'file') {
      if (!file) {
        throw new BadRequestException('file is required when type=file');
      }
      return this.service.addFileSource(id, {
        name: file.originalname,
        buffer: file.buffer,
        mimeType: file.mimetype,
        size: file.size,
      });
    }
    if (dto.type === 'url') {
      if (!dto.url) {
        throw new BadRequestException('url is required when type=url');
      }
      return this.service.addUrlSource(id, { name: dto.name, url: dto.url });
    }
    if (dto.type === 'text') {
      if (!dto.content) {
        throw new BadRequestException('content is required when type=text');
      }
      return this.service.addTextSource(id, {
        name: dto.name,
        content: dto.content,
      });
    }
    const exhaustive: never = dto.type;
    throw new BadRequestException(`Unknown source type: ${String(exhaustive)}`);
  }

  @Delete(':id/sources/:sourceId')
  @ApiOperation({
    summary: 'Delete source',
    operationId: 'deleteKnowledgeSource',
  })
  @HttpCode(204)
  async removeSource(
    @Param('id') _knowledgeId: string,
    @Param('sourceId') sourceId: string,
  ) {
    await this.service.deleteSource(sourceId);
  }
}
