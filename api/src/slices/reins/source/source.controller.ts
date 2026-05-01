import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { SourceService } from './domain/source.service';
import { CreateSourceDto } from './dtos';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('knowledge-sources')
@Controller('knowledges/:knowledgeId/sources')
export class SourceController {
  constructor(private readonly service: SourceService) {}

  @Get()
  @ApiOperation({
    summary: 'List sources',
    operationId: 'getKnowledgeSources',
  })
  list(@Param('knowledgeId') knowledgeId: string) {
    return this.service.findByKnowledge(knowledgeId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add source (file|url|text)',
    operationId: 'addKnowledgeSource',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file'))
  add(
    @Param('knowledgeId') knowledgeId: string,
    @Body() dto: CreateSourceDto,
    @UploadedFile() file?: UploadedFileLike,
  ) {
    if (dto.type === 'file') {
      if (!file) {
        throw new BadRequestException('file is required when type=file');
      }
      return this.service.addFile(knowledgeId, {
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
      return this.service.addUrl(knowledgeId, { name: dto.name, url: dto.url });
    }
    if (dto.type === 'text') {
      if (!dto.content) {
        throw new BadRequestException('content is required when type=text');
      }
      return this.service.addText(knowledgeId, {
        name: dto.name,
        content: dto.content,
      });
    }
    const exhaustive: never = dto.type;
    throw new BadRequestException(`Unknown source type: ${String(exhaustive)}`);
  }

  @Delete(':sourceId')
  @ApiOperation({
    summary: 'Delete source',
    operationId: 'deleteKnowledgeSource',
  })
  @HttpCode(204)
  async remove(
    @Param('knowledgeId') _knowledgeId: string,
    @Param('sourceId') sourceId: string,
  ) {
    await this.service.delete(sourceId);
  }
}
