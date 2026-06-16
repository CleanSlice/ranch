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
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { SourceService } from './domain/source.service';
import {
  AddFromArchiveResultDto,
  AddFromSitemapDto,
  AddFromSitemapResultDto,
  CreateSourceDto,
} from './dtos';

// Cap archive uploads at 1 GiB. The upload is buffered in memory (multer's
// default storage) and then written to a temp file for extraction. We can't
// use multer's diskStorage here: under the Bun workspace `multer` is a phantom
// dependency of @nestjs/platform-express, so `import { diskStorage } from
// 'multer'` does not resolve at runtime.
const ONE_GIB = 1024 * 1024 * 1024;

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

  @Post('from-sitemap')
  @ApiOperation({
    summary: 'Add url sources from a sitemap',
    operationId: 'addKnowledgeSourcesFromSitemap',
    description:
      'Fetches a sitemap.xml (or sitemap-index), filters by optional URL prefix, then creates one url-type source per discovered page. Indexing into LightRAG happens through the normal reindex flow.',
  })
  @ApiResponse({ status: 201, type: AddFromSitemapResultDto })
  addFromSitemap(
    @Param('knowledgeId') knowledgeId: string,
    @Body() dto: AddFromSitemapDto,
  ): Promise<AddFromSitemapResultDto> {
    return this.service.addFromSitemap(
      knowledgeId,
      dto.sitemapUrl,
      dto.urlPrefix,
    );
  }

  @Post('from-archive')
  @ApiOperation({
    summary: 'Bulk-import sources from a zip archive',
    operationId: 'addKnowledgeSourcesFromArchive',
    description:
      'Accepts a .zip, extracts every ingestable file (pdf, docx, xlsx, txt, html, ...), and creates one file-type source per entry. Upload runs in the background and streams each entry to S3; the response returns immediately with the detected file count. Indexing into LightRAG happens through the normal reindex flow.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: AddFromArchiveResultDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ONE_GIB } }))
  async addFromArchive(
    @Param('knowledgeId') knowledgeId: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<AddFromArchiveResultDto> {
    if (!file) {
      throw new BadRequestException('zip file is required (field "file")');
    }
    // The service consumes and then deletes a zip already saved on disk (see
    // its doc comment), so persist the in-memory upload to a temp file first.
    const zipPath = path.join(
      os.tmpdir(),
      `ranch-knowledge-archive-${randomUUID()}.zip`,
    );
    await fs.writeFile(zipPath, file.buffer);
    return this.service.addFromArchive(knowledgeId, zipPath);
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
