import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IKnowledgeGateway } from './knowledge.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IndexStatusTypes,
  IUpdateKnowledgeData,
  IKnowledgeQueryResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';
import { SourceService } from '../../source/domain/source.service';

const STALE_INDEX_AFTER_MS = 10 * 60 * 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: IKnowledgeGateway,
    private readonly sources: SourceService,
  ) {}

  list(): Promise<IKnowledgeData[]> {
    return this.gateway.findAll();
  }

  async get(id: string): Promise<IKnowledgeData> {
    const k = await this.gateway.findById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    return k;
  }

  create(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    return this.gateway.create(data);
  }

  async update(id: string, data: IUpdateKnowledgeData): Promise<IKnowledgeData> {
    await this.get(id);
    return this.gateway.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    try {
      await this.sources.removeAllByKnowledge(id);
    } catch (err) {
      this.logger.warn(
        `removeAllByKnowledge(${id}) failed: ${errorMessage(err)}`,
      );
    }
    await this.gateway.delete(id);
  }

  async startIndex(knowledgeId: string): Promise<void> {
    const k = await this.get(knowledgeId);

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

    await this.gateway.updateIndexState(knowledgeId, {
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
    await this.get(knowledgeId);
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
      const sources = await this.sources.findByKnowledge(knowledgeId);
      const failures: { sourceId: string; name: string; error: string }[] = [];
      const previouslyIndexed = sources.filter((s) => s.indexed).length;
      let newlyIndexed = 0;
      for (const source of sources) {
        if (source.indexed) continue;
        try {
          await this.sources.indexSource(source);
          newlyIndexed += 1;
        } catch (err) {
          // Per-source failures are isolated so one bad URL (404, empty
          // body, etc.) does not strand the rest of the batch. The
          // aggregate result is reported via indexError once the loop
          // finishes.
          const message = errorMessage(err);
          failures.push({
            sourceId: source.id,
            name: source.name,
            error: message,
          });
          this.logger.warn(
            `indexSource failed for ${source.id} (${source.name}): ${message}`,
          );
        }
      }
      const summary =
        failures.length === 0
          ? null
          : `${failures.length} source(s) failed: ${failures
              .slice(0, 5)
              .map((f) => `${f.name} (${f.error})`)
              .join('; ')}${failures.length > 5 ? '; ...' : ''}`;
      const totalIndexed = previouslyIndexed + newlyIndexed;
      // 'ready' when at least one document is indexed OR the KB is empty
      // (nothing to do is a trivially "ready" state). 'failed' only when
      // there are sources but none ever indexed - so the UI doesn't claim
      // a KB is queryable when it physically has zero documents.
      const status: IndexStatusTypes =
        totalIndexed > 0 || sources.length === 0 ? 'ready' : 'failed';
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: status,
        // Bump indexedAt only when this run actually added something.
        // Preserves the timestamp of the last successful run when the
        // current run failed everything but earlier runs had succeeded.
        indexedAt: newlyIndexed > 0 ? new Date() : undefined,
        indexError: summary,
      });
    } catch (err) {
      this.logger.error(
        `Indexing failed for knowledge ${knowledgeId}: ${errorMessage(err)}`,
      );
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: 'failed',
        indexError: errorMessage(err),
      });
    }
  }
}
