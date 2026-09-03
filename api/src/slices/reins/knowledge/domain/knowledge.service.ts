import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IKnowledgeGateway } from './knowledge.gateway';
import {
  IKnowledgeData,
  IKnowledgeRecord,
  ICreateKnowledgeData,
  IndexStatusTypes,
  IUpdateKnowledgeData,
  IFilterKnowledgeParams,
  IKnowledgePage,
  IKnowledgeQueryReference,
  IKnowledgeQueryResult,
  IGetGraphLabelsParams,
  IGraphLabelsResult,
  QueryModeTypes,
  IGetGraphParams,
  IGraphData,
} from './knowledge.types';
import { SourceService } from '../../source/domain/source.service';
import { ISourceCounts, ISourceData } from '../../source/domain/source.types';
import { staleIndexAfterMs } from '../../source/domain/indexBudget';
import { deriveIndexStatus } from './knowledge.status';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

const LABELS_DEFAULT_LIMIT = 50;
const LABELS_MAX_LIMIT = 200;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NO_SOURCES: ISourceCounts = {
  total: 0,
  indexed: 0,
  failed: 0,
  processing: 0,
};

/**
 * The retrieval service's canned response when retrieval found no context at
 * all — the one case it does not generate. Detecting it lets the product say
 * "no relevant content" instead of surfacing an apology-shaped answer.
 */
export function isNoRelevantContentAnswer(answer: string): boolean {
  const trimmed = answer.trim();
  return (
    trimmed.includes('[no-context]') ||
    trimmed.startsWith("Sorry, I'm not able to provide an answer")
  );
}

/**
 * References resolve to Source rows through file_source: new ingests carry
 * the source id, older content carries the name (text) or the URL. An
 * unresolvable reference keeps sourceId null — visible, not dropped.
 */
export function resolveReference(
  ref: { referenceId: string; filePath: string },
  sources: ISourceData[],
): IKnowledgeQueryReference {
  const match =
    sources.find((s) => s.id === ref.filePath) ??
    sources.find((s) => s.name === ref.filePath) ??
    sources.find((s) => s.url !== null && s.url === ref.filePath);
  return {
    referenceId: ref.referenceId,
    filePath: ref.filePath,
    sourceId: match?.id ?? null,
    sourceName: match?.name ?? null,
  };
}

@Injectable()
export class KnowledgeService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: IKnowledgeGateway,
    private readonly sources: SourceService,
    private readonly instances: IInstanceGateway,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
  ) {}

  onApplicationBootstrap(): void {
    void this.reconcileInstances();
  }

  /**
   * An index run lives in this process and nowhere else, so a deploy or a
   * crash takes it with it while the row keeps saying `indexing`. Nothing ever
   * cleared that, and since the admin disables the Index button on `indexing`,
   * the base became unindexable until someone called the API by hand.
   *
   * Whatever this process finds in `indexing` at startup therefore belongs to
   * a run that no longer exists: release it. LightRAG keeps working on
   * whatever was already handed to it, and the sources keep their resume
   * handles, so the next run continues rather than starting over.
   */
  async onModuleInit(): Promise<void> {
    let released = 0;
    try {
      const records = await this.gateway.findAll();
      for (const record of records) {
        if (record.indexStatus !== 'indexing') continue;
        await this.gateway.updateIndexState(record.id, {
          indexStatus: record.indexedAt ? 'ready' : 'idle',
        });
        released += 1;
      }
    } catch (err) {
      // Never block API startup over this: a stuck badge is survivable, a
      // boot loop is not.
      this.logger.warn(
        `could not release abandoned index runs: ${errorMessage(err)}`,
      );
      return;
    }
    if (released > 0) {
      this.logger.warn(
        `released ${released} knowledge base(s) left in 'indexing' by a previous process`,
      );
    }
  }

  async list(): Promise<IKnowledgeData[]> {
    const records = await this.gateway.findAll();
    return this.withCounts(records);
  }

  listPage(params: IFilterKnowledgeParams): Promise<IKnowledgePage> {
    return this.gateway.findPage(params);
  }

  async get(id: string): Promise<IKnowledgeData> {
    const k = await this.gateway.findById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    const [withCounts] = await this.withCounts([k]);
    return withCounts;
  }

  /** The read the console sees: indexStatus derived from the sources. */
  async getWithDerivedStatus(id: string): Promise<IKnowledgeData> {
    const k = await this.get(id);
    const sources = await this.sources.findByKnowledge(id);
    return {
      ...k,
      indexStatus: deriveIndexStatus(sources.map((s) => s.indexState)),
    };
  }

  async create(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    const isolation = await this.knowledgeConfig.isInstanceIsolationEnabled();
    if (isolation) await this.instances.ensureCapacityForNew();
    const created = await this.gateway.create(data);
    // Without isolation the base lives on the shared pool; provisioning an
    // instance for it would start paying for a transition nobody asked for.
    if (isolation) await this.provisionInstance(created);
    return this.get(created.id);
  }

  async update(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    await this.requireRecord(id);
    const updated = await this.gateway.update(id, data);
    const [withCounts] = await this.withCounts([updated]);
    return withCounts;
  }

  /** Existence check without the counts round trip that get() adds. */
  private async requireRecord(id: string): Promise<IKnowledgeRecord> {
    const k = await this.gateway.findById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    return k;
  }

  /**
   * Source progress is owned by the source slice; ask it once for the whole
   * batch so listing N knowledges costs one round of counts, not N.
   */
  private async withCounts(
    records: IKnowledgeRecord[],
  ): Promise<IKnowledgeData[]> {
    if (records.length === 0) return [];
    const counts = await this.sources.countByKnowledgeIds(
      records.map((r) => r.id),
    );
    return records.map((r) =>
      this.attachCounts(r, counts.get(r.id) ?? NO_SOURCES),
    );
  }

  private attachCounts(
    record: IKnowledgeRecord,
    counts: ISourceCounts,
  ): IKnowledgeData {
    return {
      ...record,
      sourceCount: counts.total,
      indexedCount: counts.indexed,
      failedCount: counts.failed,
      processingCount: counts.processing,
    };
  }

  async delete(id: string): Promise<void> {
    const record = await this.requireRecord(id);
    // Order matters: the area's content is removed while the instance can
    // still serve the delete calls, then the instance goes.
    try {
      await this.sources.removeAllByKnowledge(id);
    } catch (err) {
      this.logger.warn(
        `removeAllByKnowledge(${id}) failed: ${errorMessage(err)}`,
      );
    }
    // Even with isolation switched back off, an instance provisioned while it
    // was on must not be leaked — the record remembers one existed.
    if (
      record.instanceState !== 'absent' ||
      (await this.knowledgeConfig.isInstanceIsolationEnabled())
    ) {
      try {
        await this.instances.terminate(id);
      } catch (err) {
        this.logger.warn(`terminate(${id}) failed: ${errorMessage(err)}`);
      }
    }
    await this.gateway.delete(id);
  }

  /**
   * Bring a base's instance up and record what happened. Reused by create,
   * start-up reconciliation and the migration — provision itself is
   * idempotent, so none of them can double-provision.
   */
  async provisionInstance(k: IKnowledgeRecord): Promise<void> {
    try {
      const status = await this.instances.provision({
        knowledgeId: k.id,
        knowledgeName: k.name,
        workspace: k.workspace,
      });
      await this.gateway.updateInstanceState(k.id, {
        instanceState: status.state,
        instanceError: status.error,
        instanceEndpoint: status.endpoint,
      });
    } catch (err) {
      const message = errorMessage(err);
      this.logger.error(`provision failed for ${k.id}: ${message}`);
      await this.gateway.updateInstanceState(k.id, {
        instanceState: 'failed',
        instanceError: message,
        instanceEndpoint: null,
      });
    }
  }

  /**
   * API restart: provision what is missing, refresh what is running, and
   * REPORT orphans — an instance with no matching base is evidence of a
   * failed deletion, and deleting it would destroy the evidence along with
   * the content.
   */
  async reconcileInstances(): Promise<void> {
    try {
      if (!(await this.knowledgeConfig.isEnabled())) return;
      if (!(await this.knowledgeConfig.isInstanceIsolationEnabled())) return;
      const [bases, running] = await Promise.all([
        this.gateway.findAll(),
        this.instances.list(),
      ]);
      const byId = new Map(running.map((s) => [s.knowledgeId, s]));
      for (const k of bases) {
        const status = byId.get(k.id);
        byId.delete(k.id);
        if (!status || status.state === 'absent' || status.state === 'failed') {
          await this.provisionInstance(k);
        } else {
          await this.gateway.updateInstanceState(k.id, {
            instanceState: status.state,
            instanceError: status.error,
            instanceEndpoint: status.endpoint,
          });
        }
      }
      for (const orphan of byId.values()) {
        this.logger.warn(
          `Orphaned retrieval instance for missing base ${orphan.knowledgeId} ` +
            `(state=${orphan.state}) — left running for inspection, remove manually`,
        );
      }
    } catch (err) {
      this.logger.warn(`instance reconciliation failed: ${errorMessage(err)}`);
    }
  }

  async startIndex(knowledgeId: string): Promise<void> {
    const k = await this.requireRecord(knowledgeId);

    if (k.indexStatus === 'indexing' && k.indexStartedAt) {
      const ageMs = Date.now() - k.indexStartedAt.getTime();
      // Scaled to how much text the base holds, not how many rows: a single
      // 1 MB manual outlasts a hundred order forms, and offering a restart
      // while the first run is still waiting would set two runs fighting over
      // the same sources.
      const sources = await this.sources.findByKnowledge(knowledgeId);
      if (ageMs < staleIndexAfterMs(sources)) {
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
    const k = await this.get(knowledgeId);
    this.requireReadable(k);
    const complete = k.migrationState === 'done';

    // An empty base does not get to generate an answer from no context —
    // and the retrieval service is not even asked (FR-003). Only once the
    // base is isolated, though: pre-migration bases share one index, and
    // their rows can lag behind what that index actually holds (a stamp
    // lost to an interrupted run). Vetoing on the rows there would silence
    // content LightRAG still answers with, so until 'done' the query goes
    // through exactly as it did before isolation shipped.
    const sources = await this.sources.findByKnowledge(knowledgeId);
    const hasIndexed = sources.some((s) => s.indexState === 'indexed');
    if (complete && !hasIndexed) {
      return {
        answer: null,
        reason: 'no_relevant_content',
        knowledgeId,
        complete,
        references: [],
      };
    }

    const raw = await this.gateway.searchKnowledge(
      knowledgeId,
      query,
      mode,
      topK,
    );
    if (isNoRelevantContentAnswer(raw.answer)) {
      return {
        answer: null,
        reason: 'no_relevant_content',
        knowledgeId,
        complete,
        references: [],
      };
    }
    return {
      answer: raw.answer,
      knowledgeId,
      complete,
      references: raw.references.map((r) => resolveReference(r, sources)),
    };
  }

  async getGraphLabels(
    knowledgeId: string,
    params: IGetGraphLabelsParams = {},
  ): Promise<IGraphLabelsResult> {
    const k = await this.get(knowledgeId);
    this.requireReadable(k);
    const all = await this.gateway.getGraphLabels(knowledgeId);
    const search = params.search?.trim().toLowerCase();
    const matched = search
      ? all.filter((label) => label.toLowerCase().includes(search))
      : all;
    const limit = Math.min(
      Math.max(params.limit ?? LABELS_DEFAULT_LIMIT, 1),
      LABELS_MAX_LIMIT,
    );
    return {
      labels: matched.slice(0, limit),
      total: matched.length,
      truncated: matched.length > limit,
    };
  }

  async getGraph(
    knowledgeId: string,
    params: IGetGraphParams,
  ): Promise<IGraphData> {
    const k = await this.get(knowledgeId);
    this.requireReadable(k);
    return this.gateway.getGraph(knowledgeId, params);
  }

  /**
   * A migrated base answers only from its own instance; if that instance is
   * not ready, the failure is stated — never an empty result and never a
   * fallback to the shared pool (FR-003, spec edge case).
   */
  private requireReadable(k: IKnowledgeData): void {
    if (k.migrationState === 'done' && k.instanceState !== 'ready') {
      const detail = k.instanceError ? `: ${k.instanceError}` : '';
      throw new ServiceUnavailableException(
        `Knowledge base "${k.name}" cannot answer right now — its retrieval instance is ${k.instanceState}${detail}`,
      );
    }
  }

  private async runIndex(knowledgeId: string): Promise<void> {
    try {
      const sources = await this.sources.findByKnowledge(knowledgeId);
      // Every source goes through the gateway on every run, including ones
      // already marked indexed: the gateway re-checks them against LightRAG
      // and re-ingests anything the pipeline never actually processed. That is
      // what makes the Index button a real retry instead of a no-op.
      const outcomes = await this.sources.indexSources(sources);

      const failures = outcomes.filter((o) => o.status === 'failed');
      const stillProcessing = outcomes.filter((o) => o.status === 'pending');
      for (const failure of failures) {
        this.logger.warn(
          `indexing failed for ${failure.sourceId} (${failure.name}): ${failure.error ?? 'unknown error'}`,
        );
      }
      if (stillProcessing.length > 0) {
        this.logger.log(
          `${stillProcessing.length} source(s) still in LightRAG's pipeline; the next run will confirm them`,
        );
      }

      // Only genuine failures go into indexError. Documents the run stopped
      // waiting for are not errors: LightRAG is still working on them, they
      // show as `pending` on their own rows, and painting the whole base red
      // over them is what made every large re-index look like an outage.
      const summary =
        failures.length === 0
          ? null
          : `${failures.length} source(s) failed: ${failures
              .slice(0, 5)
              .map((f) => `${f.name} (${f.error ?? 'unknown error'})`)
              .join('; ')}${failures.length > 5 ? '; ...' : ''}`;
      const indexedCount = outcomes.filter((o) => o.indexed).length;
      // 'ready' means LightRAG confirmed at least one document as processed,
      // or the base is empty (nothing to do is trivially ready). Accepting an
      // upload is not enough: that is what used to show `ready` on a base with
      // an empty graph that answered every query with no context. A run that
      // only has documents left in the pipeline is not a failed run either -
      // it failed nothing, so it does not get the failed badge.
      const nothingWorked = indexedCount === 0 && stillProcessing.length === 0;
      const status: IndexStatusTypes =
        nothingWorked && sources.length > 0 ? 'failed' : 'ready';
      await this.gateway.updateIndexState(knowledgeId, {
        indexStatus: status,
        // Bump indexedAt only when something is actually searchable now.
        // Preserves the timestamp of the last successful run when the
        // current run failed everything but earlier runs had succeeded.
        indexedAt: indexedCount > 0 ? new Date() : undefined,
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
