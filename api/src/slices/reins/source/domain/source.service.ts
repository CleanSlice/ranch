import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ISourceGateway } from './source.gateway';
import { ISourceData } from './source.types';
import {
  fetchSitemapUrls,
  SitemapError,
} from '../data/sitemap.fetcher';

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

    let added = 0;
    for (const url of urls) {
      if (existingUrls.has(url)) continue;
      await this.gateway.create({
        knowledgeId,
        type: 'url',
        name: url,
        url,
      });
      added += 1;
    }

    return { added, discovered: urls.length };
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
