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
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ReinsService } from './domain/reins.service';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  FilterKnowledgeDto,
  QueryKnowledgeDto,
  CreateSourceDto,
} from './dtos';
import { MinioFileLoader } from './data/minio.fileLoader';

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
    private readonly minio: MinioFileLoader,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List knowledges', operationId: 'getKnowledges' })
  list(@Query() _filter: FilterKnowledgeDto) {
    return this.service.listKnowledge();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one knowledge', operationId: 'getKnowledge' })
  async getOne(@Param('id') id: string) {
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

  @Get(':id/records')
  @ApiOperation({
    summary: 'Query knowledge',
    operationId: 'getKnowledgeRecords',
  })
  async query(@Param('id') id: string, @Query() dto: QueryKnowledgeDto) {
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
  async addSource(
    @Param('id') id: string,
    @Body() dto: CreateSourceDto,
    @UploadedFile() file?: UploadedFileLike,
  ) {
    await this.service.getKnowledge(id);

    if (dto.type === 'file') {
      if (!file) throw new BadRequestException('file is required when type=file');
      const key = `${id}/${crypto.randomUUID()}-${file.originalname}`;
      const url = await this.minio.upload(key, file.buffer, file.mimetype);
      return this.service.addSource({
        knowledgeId: id,
        type: 'file',
        name: file.originalname,
        url,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });
    }

    if (dto.type === 'url') {
      if (!dto.url) throw new BadRequestException('url is required when type=url');
      return this.service.addSource({
        knowledgeId: id,
        type: 'url',
        name: dto.name,
        url: dto.url,
      });
    }

    if (dto.type === 'text') {
      if (!dto.content)
        throw new BadRequestException('content is required when type=text');
      return this.service.addSource({
        knowledgeId: id,
        type: 'text',
        name: dto.name,
        content: dto.content,
      });
    }

    throw new BadRequestException(`Unknown source type: ${dto.type as string}`);
  }

  @Delete(':id/sources/:sourceId')
  @ApiOperation({
    summary: 'Delete source',
    operationId: 'deleteKnowledgeSource',
  })
  @HttpCode(204)
  async removeSource(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
  ) {
    const source = await this.service
      .listSources(id)
      .then((list) => list.find((s) => s.id === sourceId));
    if (!source) throw new NotFoundException(`Source ${sourceId} not found`);
    if (source.url && source.type === 'file') {
      await this.minio.delete(source.url);
    }
    await this.service.deleteSource(sourceId);
  }
}
