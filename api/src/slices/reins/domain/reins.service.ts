import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IReinsGateway } from './reins.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  ISourceData,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './reins.types';

const STALE_INDEX_AFTER_MS = 10 * 60 * 1000;

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
export class ReinsService {
  private readonly logger = new Logger(ReinsService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(private readonly gateway: IReinsGateway) {}

  listKnowledge(): Promise<IKnowledgeData[]> {
    return this.gateway.findAllKnowledge();
  }

  async getKnowledge(id: string): Promise<IKnowledgeData> {
    const k = await this.gateway.findKnowledgeById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    return k;
  }

  createKnowledge(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    return this.gateway.createKnowledge(data);
  }

  async updateKnowledge(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    await this.getKnowledge(id);
    return this.gateway.updateKnowledge(id, data);
  }

  async deleteKnowledge(id: string): Promise<void> {
    await this.getKnowledge(id);
    try {
      await this.gateway.removeKnowledgeFromIndex(id);
    } catch (err) {
      this.logger.warn(
        `removeKnowledgeFromIndex(${id}) failed: ${errorMessage(err)}`,
      );
    }
    const sources = await this.gateway.findSourcesByKnowledge(id);
    for (const source of sources) {
      if (source.type === 'file' && source.url) {
        try {
          await this.gateway.deleteSourceFile(source.url);
        } catch (err) {
          this.logger.warn(
            `deleteSourceFile(${source.url}) failed: ${errorMessage(err)}`,
          );
        }
      }
    }
    await this.gateway.deleteKnowledge(id);
  }

  listSources(knowledgeId: string): Promise<ISourceData[]> {
    return this.gateway.findSourcesByKnowledge(knowledgeId);
  }

  async addFileSource(
    knowledgeId: string,
    file: IUploadedFile,
  ): Promise<ISourceData> {
    await this.getKnowledge(knowledgeId);
    const stored = await this.gateway.uploadSourceFile({
      knowledgeId,
      filename: file.name,
      body: file.buffer,
      contentType: file.mimeType,
    });
    return this.gateway.createSource({
      knowledgeId,
      type: 'file',
      name: file.name,
      url: stored.url,
      mimeType: file.mimeType,
      sizeBytes: file.size,
    });
  }

  async addUrlSource(
    knowledgeId: string,
    data: { name: string; url: string },
  ): Promise<ISourceData> {
    await this.getKnowledge(knowledgeId);
    return this.gateway.createSource({
      knowledgeId,
      type: 'url',
      name: data.name,
      url: data.url,
    });
  }

  async addTextSource(
    knowledgeId: string,
    data: { name: string; content: string },
  ): Promise<ISourceData> {
    await this.getKnowledge(knowledgeId);
    return this.gateway.createSource({
      knowledgeId,
      type: 'text',
      name: data.name,
      content: data.content,
    });
  }

  async deleteSource(id: string): Promise<void> {
    const source = await this.gateway.findSourceById(id);
    if (!source) throw new NotFoundException(`Source ${id} not found`);
    if (source.indexed) {
      try {
        await this.gateway.removeSourceFromIndex(source);
      } catch (err) {
        this.logger.warn(
          `removeSourceFromIndex(${id}) failed: ${errorMessage(err)}`,
        );
      }
    }
    if (source.type === 'file' && source.url) {
      try {
        await this.gateway.deleteSourceFile(source.url);
      } catch (err) {
        this.logger.warn(
          `deleteSourceFile(${source.url}) failed: ${errorMessage(err)}`,
        );
      }
    }
    await this.gateway.deleteSource(id);
  }

  async startIndex(knowledgeId: string): Promise<void> {
    const k = await this.getKnowledge(knowledgeId);

    if (k.indexStatus === 'indexing' && k.indexStartedAt) {
      const ageMs = Date.now() - k.indexStartedAt.getTime();
      if (ageMs < STALE_INDEX_AFTER_MS) {
        throw new Error(
          `Knowledge ${knowledgeId} already indexing (started ${Math.round(ageMs / 1000)}s ago)`,
        );
      }
      this.logger.warn(
        `Knowledge ${knowledgeId} has stale indexing state — restarting`,
      );
    }

    await this.gateway.updateKnowledgeIndexState(knowledgeId, {
      indexStatus: 'indexing',
      indexStartedAt: new Date(),
      indexError: null,
    });

    const task = this.runIndex(knowledgeId);
    this.inflightIndexing.set(knowledgeId, task);
    void task.finally(() => {
      if (this.inflightIndexing.get(knowledgeId) === task) {
        this.inflightIndexing.delete(knowledgeId);
      }
    });
  }

  async waitForIndex(knowledgeId: string): Promise<void> {
    const task = this.inflightIndexing.get(knowledgeId);
    if (task) await task;
  }

  async query(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryResult> {
    await this.getKnowledge(knowledgeId);
    return this.gateway.searchKnowledge(knowledgeId, query, mode, topK);
  }

  getGraphLabels(): Promise<string[]> {
    return this.gateway.getGraphLabels();
  }

  getGraph(params: IGetGraphParams): Promise<IGraphData> {
    return this.gateway.getGraph(params);
  }

  private async runIndex(knowledgeId: string): Promise<void> {
    try {
      const sources = await this.gateway.findSourcesByKnowledge(knowledgeId);
      for (const source of sources) {
        if (source.indexed) continue;
        await this.gateway.indexSource(source);
      }
      await this.gateway.updateKnowledgeIndexState(knowledgeId, {
        indexStatus: 'ready',
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (err) {
      this.logger.error(
        `Indexing failed for knowledge ${knowledgeId}: ${errorMessage(err)}`,
      );
      await this.gateway.updateKnowledgeIndexState(knowledgeId, {
        indexStatus: 'failed',
        indexError: errorMessage(err),
      });
    }
  }
}
