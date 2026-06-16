import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { ISourceGateway } from './source.gateway';
import { IArchiveImportResult, ISourceData } from './source.types';
import {
  fetchSitemapUrls,
  SitemapError,
} from '../data/sitemap.fetcher';
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(private readonly gateway: ISourceGateway) {}

  findByKnowledge(knowledgeId: string): Promise<ISourceData[]> {
    return this.gateway.findByKnowledgeId(knowledgeId);
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
    if (source.indexed) {
      try {
        await this.gateway.removeFromIndex(source);
      } catch (err) {
        this.logger.warn(
          `removeFromIndex(${id}) failed: ${errorMessage(err)}`,
        );
      }
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
   * S3). Returns immediately with the detected count so the HTTP request
   * doesn't hang for the minutes a large archive takes. The caller-owned
   * zip at zipPath is deleted once the background pass finishes. Indexing
   * into LightRAG is NOT triggered here - that stays the explicit Index
   * action.
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
    void this.runArchiveImport(knowledgeId, zipPath, entries);
    return { detected: entries.length, started: true };
  }

  private async runArchiveImport(
    knowledgeId: string,
    zipPath: string,
    entries: ArchiveEntry[],
  ): Promise<void> {
    let added = 0;
    let skipped = 0;
    let failed = 0;
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
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `archive entry failed ${entry.path}: ${errorMessage(err)}`,
          );
        }
      }
      this.logger.log(
        `archive import for ${knowledgeId}: added=${added} skipped=${skipped} failed=${failed}`,
      );
    } catch (err) {
      this.logger.error(
        `archive import crashed for ${knowledgeId}: ${errorMessage(err)}`,
      );
    } finally {
      await this.safeUnlink(zipPath);
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      this.logger.warn(`failed to remove temp archive ${filePath}: ${errorMessage(err)}`);
    }
  }

  indexSource(source: ISourceData): Promise<void> {
    return this.gateway.indexSource(source);
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
