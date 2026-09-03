import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { SourceService } from './domain/source.service';
import { archiveMaxBytes } from './domain/archiveLimit';
import { UploadLimitInterceptor } from './uploadLimit.interceptor';
import {
  AddFilesResultDto,
  AddFromArchiveResultDto,
  AddFromSitemapDto,
  AddFromSitemapResultDto,
  CreateSourceDto,
  ExportSourcesDto,
  FilterSourcesDto,
  ImportJobDto,
  SourceContentQueryDto,
  SourcePageDto,
} from './dtos';

// Multi-file uploads are buffered in memory (multer's default storage), so
// the batch is capped. Sized for whole documentation sets (a few hundred
// markdown/office files), not for bulk media: the ceiling is file *count*, so
// N very large files still peak at their combined size. Beyond this, the
// from-archive route is the right tool - it streams the zip to disk and then
// its entries to S3 one at a time.
const MAX_FILES_PER_BATCH = 250;

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// What multer's diskStorage hands the handler: the bytes are already on disk,
// `buffer` is absent.
interface UploadedDiskFileLike {
  originalname: string;
  size: number;
  path: string;
}

/**
 * RFC 6266 / 5987: an ASCII-only `filename` for old clients plus a UTF-8
 * `filename*` for everyone else, so a Cyrillic or Japanese document name
 * survives the round trip to the browser's download prompt.
 */
function contentDisposition(
  disposition: 'inline' | 'attachment',
  filename: string,
): string {
  const fallback =
    filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@ApiTags('knowledge-sources')
@Controller('knowledges/:knowledgeId/sources')
export class SourceController {
  constructor(private readonly service: SourceService) {}

  @Get()
  @ApiOperation({
    summary: 'List sources (paginated)',
    operationId: 'getKnowledgeSources',
  })
  @ApiOkResponse({ type: SourcePageDto })
  list(
    @Param('knowledgeId') knowledgeId: string,
    @Query() filter: FilterSourcesDto,
  ): Promise<SourcePageDto> {
    return this.service.findPage(knowledgeId, {
      page: filter.page ?? DEFAULT_PAGE,
      perPage: filter.perPage ?? DEFAULT_PER_PAGE,
      search: filter.search,
      status: filter.status,
      type: filter.type,
    });
  }

  // Declared ahead of ':sourceId/content' so Nest never reads "imports" as an id.
  @Get('imports')
  @ApiOperation({
    summary: 'Background imports for this knowledge (running and recent)',
    operationId: 'getKnowledgeSourceImports',
    description:
      'Progress of archive imports started through from-archive. Jobs are kept in memory for an hour after they finish.',
  })
  @ApiOkResponse({ type: [ImportJobDto] })
  imports(@Param('knowledgeId') knowledgeId: string): ImportJobDto[] {
    return this.service.listImports(knowledgeId);
  }

  // Declared ahead of ':sourceId/content' for the same reason as 'imports'.
  @Get('export')
  @ApiOperation({
    summary: 'Download selected sources as one zip',
    operationId: 'exportKnowledgeSources',
    description:
      'Selection is either an explicit `ids` list or the same filter the list takes, so "select all" travels as a filter rather than every id. File and text sources become entries; url sources are recorded in the `_ranch-export.yaml` manifest, whose extension the archive importer skips so the zip round-trips through from-archive.',
  })
  @ApiProduces('application/zip')
  async exportSources(
    @Param('knowledgeId') knowledgeId: string,
    @Query() query: ExportSourcesDto,
    @Res() res: Response,
  ): Promise<void> {
    // Resolve and validate before a single byte goes out: once the status line
    // is sent, a rejection can only arrive as a truncated zip.
    const sources = await this.service.prepareExport(knowledgeId, {
      ids: query.ids
        ?.split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
      search: query.search,
      status: query.status,
      type: query.type,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      contentDisposition('attachment', `${knowledgeId}-sources.zip`),
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    await this.service.writeExport(knowledgeId, sources, res);
  }

  // @Res() bypasses the global ResponseInterceptor envelope so the browser
  // gets raw bytes it can render or save (same pattern as agent file export).
  @Get(':sourceId/content')
  @ApiOperation({
    summary: 'Stream the stored bytes of a file or text source',
    operationId: 'getKnowledgeSourceContent',
    description:
      'Streams the file straight from S3 (or the text body from the row). Not available for url sources - open the url itself.',
  })
  @ApiProduces('application/octet-stream')
  async content(
    @Param('knowledgeId') knowledgeId: string,
    @Param('sourceId') sourceId: string,
    @Query() query: SourceContentQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const content = await this.service.readContent(knowledgeId, sourceId);
    res.setHeader('Content-Type', content.contentType);
    res.setHeader(
      'Content-Disposition',
      contentDisposition(query.disposition ?? 'inline', content.filename),
    );
    if (content.contentLength !== null) {
      res.setHeader('Content-Length', content.contentLength.toString());
    }
    // Let the admin read the filename back off the blob response.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    // pipeline() (unlike .pipe()) tears down the S3 stream when the client
    // aborts, so a cancelled preview does not leak an SDK socket. Once headers
    // are out an error can only cut the response short, which is what we want:
    // a truncated download rather than a "complete" one.
    try {
      await pipeline(content.body, res);
    } catch (err) {
      if (!res.headersSent) throw err;
      res.destroy();
    }
  }

  @Post(':sourceId/reindex')
  @ApiOperation({
    summary: 'Retry indexing a single source',
    operationId: 'reindexKnowledgeSource',
    description:
      'Requeues one source and re-ingests it without touching the rest of the batch. Progress is reported through the source own indexState.',
  })
  @HttpCode(202)
  async reindex(
    @Param('knowledgeId') knowledgeId: string,
    @Param('sourceId') sourceId: string,
  ) {
    await this.service.reindexSource(knowledgeId, sourceId);
    return { ok: true };
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

  @Post('files')
  @ApiOperation({
    summary: 'Add several file sources at once',
    operationId: 'addKnowledgeFileSources',
    description:
      'Accepts a multi-file selection (field "files") and creates one file-type source per upload. Runs inline and returns per-batch counts. Files whose name already exists on this knowledge are skipped; a single failed file does not abort the rest. Indexing into LightRAG happens through the normal reindex flow.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: AddFilesResultDto })
  @UseInterceptors(
    new UploadLimitInterceptor('files', MAX_FILES_PER_BATCH),
    FilesInterceptor('files', MAX_FILES_PER_BATCH),
  )
  addFiles(
    @Param('knowledgeId') knowledgeId: string,
    @UploadedFiles() files?: UploadedFileLike[],
  ): Promise<AddFilesResultDto> {
    if (!files?.length) {
      throw new BadRequestException(
        'at least one file is required (field "files")',
      );
    }
    return this.service.addFiles(
      knowledgeId,
      files.map((file) => ({
        name: file.originalname,
        buffer: file.buffer,
        mimeType: file.mimetype,
        size: file.size,
      })),
    );
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

  // The zip streams to a temp file as it arrives - it never sits in memory.
  // With multer's default memory storage a 1 GiB archive was 1 GiB of heap
  // on a pod with a 512Mi limit, i.e. an OOM kill before extraction began.
  @Post('from-archive')
  @ApiOperation({
    summary: 'Bulk-import sources from a zip archive',
    operationId: 'addKnowledgeSourcesFromArchive',
    description:
      'Accepts a .zip, extracts every ingestable file (pdf, docx, xlsx, txt, html, ...), and creates one file-type source per entry. Upload runs in the background and streams each entry to S3; the response returns immediately with the detected file count and a job id to poll via GET .../sources/imports. Indexing into LightRAG happens through the normal reindex flow. Max size: KNOWLEDGE_ARCHIVE_MAX_BYTES (default 4 GiB).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: AddFromArchiveResultDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, cb) =>
          cb(null, `ranch-knowledge-archive-${randomUUID()}.zip`),
      }),
      // A getter, not a value: this decorator runs at import time, before
      // ConfigModule has loaded .env.dev into process.env. busboy reads the
      // limit per request, so resolving lazily picks up the configured value.
      limits: {
        get fileSize(): number {
          return archiveMaxBytes();
        },
      },
    }),
  )
  async addFromArchive(
    @Param('knowledgeId') knowledgeId: string,
    @UploadedFile() file?: UploadedDiskFileLike,
  ): Promise<AddFromArchiveResultDto> {
    if (!file) {
      throw new BadRequestException('zip file is required (field "file")');
    }
    // The service consumes and then deletes the zip at file.path.
    return this.service.addFromArchive(knowledgeId, file.path);
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
