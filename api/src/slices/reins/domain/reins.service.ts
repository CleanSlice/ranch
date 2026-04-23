import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IReinsGateway } from './reins.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IKnowledgeQueryRecord,
  QueryModeTypes,
} from './reins.types';
import { ILightragClient } from '../data/lightrag.client';

const STALE_INDEX_AFTER_MS = 10 * 60 * 1000;

export interface IFileLoader {
  loadFile(url: string): Promise<Buffer>;
}

@Injectable()
export class ReinsService {
  private readonly logger = new Logger(ReinsService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: IReinsGateway,
    private readonly client: ILightragClient,
    private readonly fileLoader: IFileLoader,
  ) {}

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
    const k = await this.getKnowledge(id);
    try {
      await this.client.deleteWorkspace(k.workspace);
    } catch (err) {
      this.logger.warn(
        `LightRAG deleteWorkspace(${k.workspace}) failed: ${(err as Error).message}`,
      );
    }
    await this.gateway.deleteKnowledge(id);
  }

  listSources(knowledgeId: string): Promise<IReinsSourceData[]> {
    return this.gateway.findSourcesByKnowledge(knowledgeId);
  }

  async addSource(data: ICreateSourceData): Promise<IReinsSourceData> {
    return this.gateway.createSource(data);
  }

  async deleteSource(id: string): Promise<void> {
    const source = await this.gateway.findSourceById(id);
    if (!source) throw new NotFoundException(`Source ${id} not found`);
    if (source.lightragDocId) {
      const k = await this.gateway.findKnowledgeById(source.knowledgeId);
      if (k) {
        try {
          await this.client.deleteDocument(k.workspace, source.lightragDocId);
        } catch (err) {
          this.logger.warn(
            `LightRAG deleteDocument failed for source ${id}: ${(err as Error).message}`,
          );
        }
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

    const task = this.runIndex(knowledgeId, k.workspace);
    this.inflightIndexing.set(knowledgeId, task);
    task.finally(() => {
      if (this.inflightIndexing.get(knowledgeId) === task) {
        this.inflightIndexing.delete(knowledgeId);
      }
    });
  }

  /** Resolves when the current indexing run finishes. Useful for callers that want to block. */
  async waitForIndex(knowledgeId: string): Promise<void> {
    const task = this.inflightIndexing.get(knowledgeId);
    if (task) await task;
  }

  private async runIndex(knowledgeId: string, workspace: string): Promise<void> {
    try {
      const sources = await this.gateway.findSourcesByKnowledge(knowledgeId);
      for (const source of sources) {
        if (source.lightragDocId) continue;
        await this.ingestSource(source, workspace);
      }
      await this.gateway.updateKnowledgeIndexState(knowledgeId, {
        indexStatus: 'ready',
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (err) {
      this.logger.error(
        `Indexing failed for knowledge ${knowledgeId}: ${(err as Error).message}`,
      );
      await this.gateway.updateKnowledgeIndexState(knowledgeId, {
        indexStatus: 'failed',
        indexError: (err as Error).message,
      });
    }
  }

  private async ingestSource(
    source: IReinsSourceData,
    workspace: string,
  ): Promise<void> {
    if (source.type === 'text') {
      if (!source.content) {
        throw new Error(`Source ${source.id} has no content`);
      }
      const res = await this.client.ingestText({
        workspace,
        text: source.content,
        fileSource: source.name,
      });
      await this.gateway.setSourceLightragDocId(source.id, res.docId);
      return;
    }
    if (source.type === 'url') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const res = await this.client.ingestUrl({ workspace, url: source.url });
      await this.gateway.setSourceLightragDocId(source.id, res.docId);
      return;
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const buffer = await this.fileLoader.loadFile(source.url);
      const res = await this.client.ingestFile({
        workspace,
        filename: source.name,
        mimeType: source.mimeType ?? 'application/octet-stream',
        content: buffer,
      });
      await this.gateway.setSourceLightragDocId(source.id, res.docId);
      return;
    }
    throw new Error(`Unknown source type: ${source.type as string}`);
  }

  async query(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryRecord[]> {
    const k = await this.getKnowledge(knowledgeId);
    return this.client.query({
      workspace: k.workspace,
      query,
      mode,
      topK,
    });
  }
}
