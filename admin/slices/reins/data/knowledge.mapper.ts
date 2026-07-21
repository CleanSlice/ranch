import type {
  IGraph,
  IKnowledge,
  IKnowledgeSetupStatus,
  IKnowledgeStatus,
  IndexStatus,
  IQueryResult,
  ISource,
  ISourceArchiveResult,
  ISourceSitemapResult,
  SourceType,
} from '../domain/knowledge.types';

const INDEX_STATUSES = new Set<IndexStatus>([
  'idle',
  'indexing',
  'ready',
  'failed',
]);
const SOURCE_TYPES = new Set<SourceType>(['file', 'url', 'text']);

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
      entityTypes: strList(o.entityTypes),
      relationshipTypes: strList(o.relationshipTypes),
      indexStatus:
        typeof o.indexStatus === 'string' &&
        INDEX_STATUSES.has(o.indexStatus as IndexStatus)
          ? (o.indexStatus as IndexStatus)
          : 'idle',
      indexError: nullableStr(o.indexError),
      indexedAt: nullableStr(o.indexedAt),
      indexStartedAt: nullableStr(o.indexStartedAt),
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

  toStatus(raw: unknown): IKnowledgeStatus {
    if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') {
      return { enabled: false, setup: { ...EMPTY_SETUP } };
    }
    const o = raw as Record<string, unknown>;
    return { enabled: o.enabled === true, setup: this.toSetup(o.setup) };
  }

  toQueryResult(raw: unknown): IQueryResult {
    if (raw && typeof raw === 'object') return raw as IQueryResult;
    return { answer: '', references: [] };
  }

  toGraph(raw: unknown): IGraph {
    if (raw && typeof raw === 'object') return raw as IGraph;
    return { nodes: [], edges: [], isTruncated: false };
  }

  toArchiveResult(raw: unknown): ISourceArchiveResult {
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (typeof o.detected === 'number' && typeof o.started === 'boolean') {
        return { detected: o.detected, started: o.started };
      }
    }
    return { detected: 0, started: false };
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

  toLabels(raw: unknown): string[] {
    return strList(raw);
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
