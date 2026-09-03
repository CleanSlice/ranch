import type {
  IGraph,
  IGraphLabels,
  IImportJob,
  IKnowledge,
  IKnowledgePage,
  IKnowledgeRuntimeConfig,
  IKnowledgeSetupStatus,
  IKnowledgeStatus,
  ImportJobStatus,
  IndexStatus,
  InstanceState,
  IQueryResult,
  ISource,
  ISourceArchiveResult,
  ISourceFilesResult,
  ISourceFilter,
  ISourcePage,
  ISourceSitemapResult,
  MigrationState,
  SourceIndexState,
  SourceIndexStatus,
  SourceType,
} from '../domain/knowledge.types';

const INDEX_STATUSES = new Set<IndexStatus>([
  'idle',
  'indexing',
  'ready',
  'failed',
  'empty',
  'partial',
]);
const SOURCE_TYPES = new Set<SourceType>(['file', 'url', 'text']);
const SOURCE_INDEX_STATUSES = new Set<SourceIndexStatus>([
  'indexed',
  'pending',
  'failed',
]);
const IMPORT_JOB_STATUSES = new Set<ImportJobStatus>([
  'running',
  'done',
  'failed',
]);

function isSourceIndexStatus(value: unknown): value is SourceIndexStatus {
  return (
    typeof value === 'string' &&
    SOURCE_INDEX_STATUSES.has(value as SourceIndexStatus)
  );
}

function isImportJobStatus(value: unknown): value is ImportJobStatus {
  return (
    typeof value === 'string' && IMPORT_JOB_STATUSES.has(value as ImportJobStatus)
  );
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const SOURCE_INDEX_STATES = new Set<SourceIndexState>([
  'queued',
  'processing',
  'indexed',
  'failed',
]);
const INSTANCE_STATES = new Set<InstanceState>([
  'absent',
  'starting',
  'ready',
  'failed',
  'stopping',
]);
const MIGRATION_STATES = new Set<MigrationState>([
  'notStarted',
  'inProgress',
  'done',
  'failed',
]);

const EMPTY_SETUP: IKnowledgeSetupStatus = {
  hasChatCredential: false,
  hasEmbeddingCredential: false,
  hasUrl: false,
  hasBucket: false,
  hasCredentialsSelected: false,
  isHealthy: false,
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : [];
}

function bool(value: unknown): boolean {
  return value === true;
}

/** Maps the knowledge-bases API onto domain shapes; reads defensively. */
export class KnowledgeMapper {
  toKnowledge(raw: unknown): IKnowledge | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      description: nullableStr(o.description),
      indexStatus:
        typeof o.indexStatus === 'string' &&
        INDEX_STATUSES.has(o.indexStatus as IndexStatus)
          ? (o.indexStatus as IndexStatus)
          : 'idle',
      indexError: nullableStr(o.indexError),
      indexedAt: nullableStr(o.indexedAt),
      indexStartedAt: nullableStr(o.indexStartedAt),
      sourceCount: num(o.sourceCount),
      indexedCount: num(o.indexedCount),
      failedCount: num(o.failedCount),
      processingCount: num(o.processingCount),
      instanceState:
        typeof o.instanceState === 'string' &&
        INSTANCE_STATES.has(o.instanceState as InstanceState)
          ? (o.instanceState as InstanceState)
          : 'absent',
      instanceError: nullableStr(o.instanceError),
      migrationState:
        typeof o.migrationState === 'string' &&
        MIGRATION_STATES.has(o.migrationState as MigrationState)
          ? (o.migrationState as MigrationState)
          : 'done',
      sourcesCount:
        typeof o.sourcesCount === 'number' ? o.sourcesCount : undefined,
      totalSizeBytes:
        typeof o.totalSizeBytes === 'number' ? o.totalSizeBytes : undefined,
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
      sources: Array.isArray(o.sources) ? this.toSourceList(o.sources) : undefined,
    };
  }

  toKnowledgeList(raw: unknown): IKnowledge[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((k) => this.toKnowledge(k))
      .filter((k): k is IKnowledge => k !== null);
  }

  toKnowledgePage(raw: unknown): IKnowledgePage {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      return {
        items: this.toKnowledgeList(o.items),
        total: typeof o.total === 'number' ? o.total : 0,
        page: typeof o.page === 'number' ? o.page : 1,
        perPage: typeof o.perPage === 'number' ? o.perPage : 50,
      };
    }
    return { items: [], total: 0, page: 1, perPage: 50 };
  }

  toSource(raw: unknown): ISource | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      knowledgeId: str(o.knowledgeId),
      type:
        typeof o.type === 'string' && SOURCE_TYPES.has(o.type as SourceType)
          ? (o.type as SourceType)
          : 'file',
      name: str(o.name),
      url: nullableStr(o.url),
      mimeType: nullableStr(o.mimeType),
      content: nullableStr(o.content),
      sizeBytes: typeof o.sizeBytes === 'number' ? o.sizeBytes : null,
      indexed: bool(o.indexed),
      // Older API builds only send `indexed`; derive the status from it so
      // the table still renders sensibly against them.
      indexStatus: isSourceIndexStatus(o.indexStatus)
        ? o.indexStatus
        : bool(o.indexed)
          ? 'indexed'
          : 'pending',
      indexState:
        typeof o.indexState === 'string' &&
        SOURCE_INDEX_STATES.has(o.indexState as SourceIndexState)
          ? (o.indexState as SourceIndexState)
          : 'queued',
      indexError: nullableStr(o.indexError),
      indexedAt: nullableStr(o.indexedAt),
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
  }

  toSourceList(raw: unknown): ISource[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s) => this.toSource(s))
      .filter((s): s is ISource => s !== null);
  }

  toSourcePage(raw: unknown, requested: ISourceFilter): ISourcePage {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      return {
        items: this.toSourceList(o.items),
        total: num(o.total),
        page: num(o.page) || requested.page,
        perPage: num(o.perPage) || requested.perPage,
      };
    }
    return { items: [], total: 0, page: requested.page, perPage: requested.perPage };
  }

  toImportJob(raw: unknown): IImportJob | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      knowledgeId: str(o.knowledgeId),
      kind: 'archive',
      status: isImportJobStatus(o.status) ? o.status : 'done',
      detected: num(o.detected),
      added: num(o.added),
      skipped: num(o.skipped),
      failed: num(o.failed),
      errors: strList(o.errors),
      startedAt: str(o.startedAt),
      finishedAt: nullableStr(o.finishedAt),
    };
  }

  toImportJobs(raw: unknown): IImportJob[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((j) => this.toImportJob(j))
      .filter((j): j is IImportJob => j !== null);
  }

  toStatus(raw: unknown): IKnowledgeStatus {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') {
      return { enabled: false, setup: { ...EMPTY_SETUP }, runtime: null };
    }
    const o = raw as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      setup: this.toSetup(o.setup),
      runtime: this.toRuntime(o.runtime),
    };
  }

  private toRuntime(raw: unknown): IKnowledgeRuntimeConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const nullableStr = (value: unknown): string | null =>
      typeof value === 'string' && value.length > 0 ? value : null;
    return {
      llmBinding: nullableStr(o.llmBinding),
      llmModel: nullableStr(o.llmModel),
      embeddingBinding: nullableStr(o.embeddingBinding),
      embeddingModel: nullableStr(o.embeddingModel),
      embeddingBindingHost: nullableStr(o.embeddingBindingHost),
    };
  }

  toQueryResult(raw: unknown): IQueryResult {
    if (raw && typeof raw === 'object') return raw as IQueryResult;
    return {
      answer: null,
      knowledgeId: '',
      complete: true,
      references: [],
    };
  }

  toGraph(raw: unknown): IGraph {
    if (raw && typeof raw === 'object') return raw as IGraph;
    return { nodes: [], edges: [], isTruncated: false };
  }

  toArchiveResult(raw: unknown): ISourceArchiveResult {
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (typeof o.detected === 'number' && typeof o.started === 'boolean') {
        return { detected: o.detected, started: o.started, jobId: str(o.jobId) };
      }
    }
    return { detected: 0, started: false, jobId: '' };
  }

  toFilesResult(raw: unknown): ISourceFilesResult {
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (
        typeof o.added === 'number' &&
        typeof o.skipped === 'number' &&
        typeof o.failed === 'number'
      ) {
        return {
          added: o.added,
          skipped: o.skipped,
          failed: o.failed,
          errors: strList(o.errors),
        };
      }
    }
    return { added: 0, skipped: 0, failed: 0, errors: [] };
  }

  toSitemapResult(raw: unknown): ISourceSitemapResult {
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (typeof o.added === 'number' && typeof o.discovered === 'number') {
        return { added: o.added, discovered: o.discovered };
      }
    }
    return { added: 0, discovered: 0 };
  }

  toLabelsResult(raw: unknown): IGraphLabels {
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      return {
        labels: strList(o.labels),
        total: typeof o.total === 'number' ? o.total : 0,
        truncated: bool(o.truncated),
      };
    }
    return { labels: [], total: 0, truncated: false };
  }

  private toSetup(raw: unknown): IKnowledgeSetupStatus {
    if (!raw || typeof raw !== 'object') return { ...EMPTY_SETUP };
    const o = raw as Record<string, unknown>;
    return {
      hasChatCredential: bool(o.hasChatCredential),
      hasEmbeddingCredential: bool(o.hasEmbeddingCredential),
      hasUrl: bool(o.hasUrl),
      hasBucket: bool(o.hasBucket),
      hasCredentialsSelected: bool(o.hasCredentialsSelected),
      isHealthy: bool(o.isHealthy),
    };
  }
}
