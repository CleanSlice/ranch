import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { Writable } from 'stream';
import { ISourceGateway } from './source.gateway';
import { ImportJobRegistry } from './importJob.registry';
import {
  IArchiveImportResult,
  IFilesImportResult,
  IImportJob,
  ISourceContent,
  ISourceCounts,
  ISourceData,
  ISourceFilter,
  ISourceIndexOutcome,
  ISourcePage,
  ISourceSelection,
} from './source.types';
import { fetchSitemapUrls, SitemapError } from '../data/sitemap.fetcher';
import { writeSourceArchive } from '../data/sourceArchive.writer';
import {
  ArchiveEntry,
  contentTypeForEntry,
  displayNameForEntry,
  listIngestableEntries,
} from '../data/archive.extractor';

export interface IAddFromSitemapResult {
  added: number;
  discovered: number;
}

export interface IUploadedFile {
  name: string;
  buffer: Buffer;
  mimeType: string;
  size: number;
}

// A base this size is a migration, not a click. Refuse instead of streaming
// something nobody will wait for; the filter is there to narrow it.
const MAX_EXPORT_SOURCES = 2000;
const MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(
    private readonly gateway: ISourceGateway,
    private readonly imports: ImportJobRegistry,
  ) {}

  findByKnowledge(knowledgeId: string): Promise<ISourceData[]> {
    return this.gateway.findByKnowledgeId(knowledgeId);
  }

  findPage(knowledgeId: string, filter: ISourceFilter): Promise<ISourcePage> {
    return this.gateway.findPage(knowledgeId, filter);
  }

  countByKnowledgeIds(
    knowledgeIds: string[],
  ): Promise<Map<string, ISourceCounts>> {
    return this.gateway.countByKnowledgeIds(knowledgeIds);
  }

  async readContent(
    knowledgeId: string,
    sourceId: string,
  ): Promise<ISourceContent> {
    const source = await this.gateway.findById(sourceId);
    if (!source || source.knowledgeId !== knowledgeId) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }
    return this.gateway.readContent(source);
  }

  listImports(knowledgeId: string): IImportJob[] {
    return this.imports.listByKnowledge(knowledgeId);
  }

  async addFile(
    knowledgeId: string,
    file: IUploadedFile,
  ): Promise<ISourceData> {
    const stored = await this.gateway.uploadFile({
      knowledgeId,
      filename: file.name,
      body: file.buffer,
      contentType: file.mimeType,
    });
    return this.gateway.create({
      knowledgeId,
      type: 'file',
      name: file.name,
      url: stored.url,
      mimeType: file.mimeType,
      sizeBytes: file.size,
    });
  }

  /**
   * Upload a hand-picked batch of files in one request. Unlike the archive
   * import this runs inline rather than in the background: a manual selection
   * is small enough that the caller wants the outcome (and a refreshed list)
   * straight away. Names already on the knowledge are skipped, matching the
   * archive importer, so re-submitting a selection can't duplicate sources.
   * One bad file fails only itself - the rest of the batch still lands.
   */
  async addFiles(
    knowledgeId: string,
    files: IUploadedFile[],
  ): Promise<IFilesImportResult> {
    const existing = await this.gateway.findByKnowledgeId(knowledgeId);
    const takenNames = new Set(
      existing.filter((s) => s.type === 'file').map((s) => s.name),
    );

    const result: IFilesImportResult = {
      added: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const file of files) {
      if (takenNames.has(file.name)) {
        result.skipped += 1;
        continue;
      }
      takenNames.add(file.name);
      try {
        await this.addFile(knowledgeId, file);
        result.added += 1;
      } catch (err) {
        result.failed += 1;
        result.errors.push(`${file.name}: ${errorMessage(err)}`);
        this.logger.warn(
          `addFiles entry failed ${file.name}: ${errorMessage(err)}`,
        );
      }
    }

    this.logger.log(
      `file batch for ${knowledgeId}: added=${result.added} skipped=${result.skipped} failed=${result.failed}`,
    );
    return result;
  }

  addUrl(
    knowledgeId: string,
    data: { name: string; url: string },
  ): Promise<ISourceData> {
    return this.gateway.create({
      knowledgeId,
      type: 'url',
      name: data.name,
      url: data.url,
    });
  }

  addText(
    knowledgeId: string,
    data: { name: string; content: string },
  ): Promise<ISourceData> {
    return this.gateway.create({
      knowledgeId,
      type: 'text',
      name: data.name,
      content: data.content,
    });
  }

  async delete(id: string): Promise<void> {
    const source = await this.gateway.findById(id);
    if (!source) throw new NotFoundException(`Source ${id} not found`);
    try {
      // No-ops when the source was never handed to the retrieval service.
      await this.gateway.removeFromIndex(source);
    } catch (err) {
      this.logger.warn(`removeFromIndex(${id}) failed: ${errorMessage(err)}`);
    }
    if (source.type === 'file' && source.url) {
      try {
        await this.gateway.deleteFile(source.url);
      } catch (err) {
        this.logger.warn(
          `deleteFile(${source.url}) failed: ${errorMessage(err)}`,
        );
      }
    }
    await this.gateway.delete(id);
  }

  /**
   * Accepts an already-saved zip on disk, lists its ingestable entries, and
   * kicks off a background import (one file-source per entry, streamed to
   * S3). Returns immediately with the detected count and a job id so the
   * HTTP request doesn't hang for the minutes a large archive takes; the
   * sources page polls the job for progress. The caller-owned zip at zipPath
   * is deleted once the background pass finishes. Indexing into LightRAG is
   * NOT triggered here - that stays the explicit Index action.
   */
  async addFromArchive(
    knowledgeId: string,
    zipPath: string,
  ): Promise<IArchiveImportResult> {
    let entries: ArchiveEntry[];
    try {
      entries = await listIngestableEntries(zipPath);
    } catch (err) {
      await this.safeUnlink(zipPath);
      throw new BadRequestException(
        `Could not read archive: ${errorMessage(err)}`,
      );
    }
    if (entries.length === 0) {
      await this.safeUnlink(zipPath);
      throw new BadRequestException(
        'Archive contains no ingestable files (pdf, docx, xlsx, txt, html, ...).',
      );
    }
    const job = this.imports.create(knowledgeId, 'archive', entries.length);
    void this.runArchiveImport(job.id, knowledgeId, zipPath, entries);
    return { detected: entries.length, started: true, jobId: job.id };
  }

  private async runArchiveImport(
    jobId: string,
    knowledgeId: string,
    zipPath: string,
    entries: ArchiveEntry[],
  ): Promise<void> {
    let added = 0;
    let skipped = 0;
    let failed = 0;
    let crashed: string | null = null;
    try {
      const existing = await this.gateway.findByKnowledgeId(knowledgeId);
      const existingNames = new Set(
        existing.filter((s) => s.type === 'file').map((s) => s.name),
      );
      const seenPaths = new Set<string>();

      for (const entry of entries) {
        const name = displayNameForEntry(entry.path);
        if (seenPaths.has(entry.path) || existingNames.has(name)) {
          skipped += 1;
          this.imports.progress(jobId, { skipped: 1 });
          continue;
        }
        seenPaths.add(entry.path);
        const contentType = contentTypeForEntry(entry.path);
        try {
          const stored = await this.gateway.uploadFileStream({
            knowledgeId,
            filename: name,
            body: entry.openStream(),
            contentType,
          });
          await this.gateway.create({
            knowledgeId,
            type: 'file',
            name,
            url: stored.url,
            mimeType: contentType,
            sizeBytes: entry.size,
          });
          added += 1;
          this.imports.progress(jobId, { added: 1 });
        } catch (err) {
          failed += 1;
          this.imports.progress(jobId, {
            failed: 1,
            error: `${name}: ${errorMessage(err)}`,
          });
          this.logger.warn(
            `archive entry failed ${entry.path}: ${errorMessage(err)}`,
          );
        }
      }
      this.logger.log(
        `archive import for ${knowledgeId}: added=${added} skipped=${skipped} failed=${failed}`,
      );
    } catch (err) {
      crashed = errorMessage(err);
      this.logger.error(
        `archive import crashed for ${knowledgeId}: ${crashed}`,
      );
    } finally {
      await this.safeUnlink(zipPath);
      if (crashed === null) {
        this.imports.finish(jobId, 'done');
      } else {
        this.imports.finish(
          jobId,
          'failed',
          `archive import crashed: ${crashed}`,
        );
      }
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      this.logger.warn(
        `failed to remove temp archive ${filePath}: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * Resolve what an export request selected, and refuse rather than truncate
   * when it is too big. Separate from the writing step so a rejection is a
   * clean 400 - once the first zip byte is on the wire the status line is
   * already sent and the client gets a corrupt download instead of an error.
   */
  async prepareExport(
    knowledgeId: string,
    selection: ISourceSelection,
  ): Promise<ISourceData[]> {
    const sources = await this.gateway.findForExport(knowledgeId, selection);
    if (sources.length === 0) {
      throw new BadRequestException('No sources matched the selection.');
    }
    if (sources.length > MAX_EXPORT_SOURCES) {
      throw new BadRequestException(
        `Selection is ${sources.length} sources; the export is capped at ${MAX_EXPORT_SOURCES}. Narrow it with the filter.`,
      );
    }
    const bytes = sources.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0);
    if (bytes > MAX_EXPORT_BYTES) {
      throw new BadRequestException(
        `Selection is ${Math.round(bytes / 1024 / 1024)} MB; the export is capped at ${Math.round(MAX_EXPORT_BYTES / 1024 / 1024)} MB.`,
      );
    }
    return sources;
  }

  /**
   * Stream the selected sources into `out` as a zip, one source at a time.
   * `url` sources have no bytes and are recorded in the manifest instead, so
   * they never reach the reader.
   */
  writeExport(
    knowledgeId: string,
    sources: ISourceData[],
    out: Writable,
  ): Promise<void> {
    return writeSourceArchive(
      knowledgeId,
      sources,
      async (source) => ({
        body: (await this.gateway.readContent(source)).body,
      }),
      out,
    );
  }

  indexSources(sources: ISourceData[]): Promise<ISourceIndexOutcome[]> {
    return this.gateway.indexSources(sources);
  }

  findUnconfirmed(): Promise<ISourceData[]> {
    return this.gateway.findUnconfirmed();
  }

  confirmProcessed(sources: ISourceData[]): Promise<ISourceIndexOutcome[]> {
    return this.gateway.confirmProcessed(sources);
  }

  /**
   * Hand the source over AND wait until the retrieval service reports it
   * processed — "indexed" means searchable, not merely submitted. Returns
   * the source with its terminal state recorded.
   */
  async indexSourceAndWait(source: ISourceData): Promise<ISourceData> {
    await this.gateway.indexSource(source);
    return this.gateway.waitForSourceIndexed(source.id);
  }

  requeueSource(sourceId: string): Promise<void> {
    return this.gateway.updateIndexState(sourceId, {
      indexState: 'queued',
      indexError: null,
    });
  }

  /**
   * Retry a single failed source without touching the rest of the batch
   * (FR-032). Runs in the background; per-source state reports the outcome.
   */
  async reindexSource(knowledgeId: string, sourceId: string): Promise<void> {
    const source = await this.gateway.findById(sourceId);
    if (!source || source.knowledgeId !== knowledgeId) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }
    await this.requeueSource(sourceId);
    void this.indexSourceAndWait({ ...source, indexState: 'queued' }).catch(
      (err) => {
        this.logger.warn(`reindex of ${sourceId} failed: ${errorMessage(err)}`);
      },
    );
  }

  /**
   * Walk a sitemap, optionally filter by URL prefix, then create one
   * url-type Source per discovered page. Indexing into LightRAG happens
   * later through the normal reindex flow - this method only enqueues the
   * sources. Existing url sources with the same URL are skipped so calling
   * this twice doesn't duplicate them (useful as a manual refresh until
   * scheduled refresh lands).
   */
  async addFromSitemap(
    knowledgeId: string,
    sitemapUrl: string,
    urlPrefix?: string,
  ): Promise<IAddFromSitemapResult> {
    let urls: string[];
    try {
      urls = await fetchSitemapUrls(sitemapUrl, { urlPrefix });
    } catch (e) {
      if (e instanceof SitemapError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const existing = await this.gateway.findByKnowledgeId(knowledgeId);
    const existingUrls = new Set(
      existing
        .filter((s) => s.type === 'url' && s.url !== null)
        .map((s) => s.url),
    );

    // Sitemaps occasionally list the same <loc> twice (mirrored sections,
    // paginated archives) - dedup within the batch before checking against
    // existing rows so a single duplicate can't trip a unique-index error.
    const uniqueUrls = Array.from(new Set(urls));

    const toCreate = uniqueUrls
      .filter((url) => !existingUrls.has(url))
      .map((url) => ({
        knowledgeId,
        type: 'url' as const,
        name: url,
        url,
      }));

    if (toCreate.length > 0) {
      await this.gateway.createMany(toCreate);
    }

    return { added: toCreate.length, discovered: urls.length };
  }

  async removeAllByKnowledge(knowledgeId: string): Promise<void> {
    const sources = await this.gateway.findByKnowledgeId(knowledgeId);
    try {
      await this.gateway.removeAllByKnowledge(knowledgeId);
    } catch (err) {
      this.logger.warn(
        `removeAllByKnowledge(${knowledgeId}) lightrag cleanup failed: ${errorMessage(err)}`,
      );
    }
    for (const source of sources) {
      if (source.type === 'file' && source.url) {
        try {
          await this.gateway.deleteFile(source.url);
        } catch (err) {
          this.logger.warn(
            `deleteFile(${source.url}) failed: ${errorMessage(err)}`,
          );
        }
      }
    }
  }
}
