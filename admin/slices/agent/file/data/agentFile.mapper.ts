import type {
  FileKind,
  IFileChunk,
  IFileContent,
  IFileLimits,
  IFileNode,
  ISyncResult,
} from '../domain/agentFile.types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function kind(value: unknown): FileKind {
  return value === 'binary' ? 'binary' : 'text';
}

/** Maps the files API onto domain shapes; reads defensively. */
export class AgentFileMapper {
  toNodeList(raw: unknown): IFileNode[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toNode(item))
      .filter((n): n is IFileNode => n !== null);
  }

  toContent(raw: unknown): IFileContent | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string') return null;
    return {
      path: o.path,
      content: str(o.content),
      size: num(o.size),
      updatedAt: str(o.updatedAt),
      kind: kind(o.kind),
      editable: o.editable === true,
    };
  }

  toChunk(raw: unknown): IFileChunk | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string') return null;
    return {
      path: o.path,
      content: str(o.content),
      size: num(o.size),
      totalSize: num(o.totalSize),
      offset: num(o.offset),
      nextOffset: typeof o.nextOffset === 'number' ? o.nextOffset : null,
      hasMore: o.hasMore === true,
      updatedAt: str(o.updatedAt),
      kind: kind(o.kind),
      editable: o.editable === true,
    };
  }

  toLimits(raw: unknown): IFileLimits {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      maxEditBytes: num(o.maxEditBytes),
      maxViewBytes: num(o.maxViewBytes),
      rangeBytes: num(o.rangeBytes),
      maxRangeBytes: num(o.maxRangeBytes),
      openLinkTtlSec: num(o.openLinkTtlSec),
      importMaxArchiveBytes: num(o.importMaxArchiveBytes),
      importMaxEntries: num(o.importMaxEntries),
      importMaxFileBytes: num(o.importMaxFileBytes),
      importPlanListRows: num(o.importPlanListRows),
      diffCompareMaxBytes: num(o.diffCompareMaxBytes),
      diffInlineMaxLines: num(o.diffInlineMaxLines),
      diffInlineMaxBytes: num(o.diffInlineMaxBytes),
      proposalListRows: num(o.proposalListRows),
      textExtensions: Array.isArray(o.textExtensions)
        ? o.textExtensions.filter((e): e is string => typeof e === 'string')
        : [],
    };
  }

  toSyncResult(raw: unknown): ISyncResult {
    if (!raw || typeof raw !== 'object') return { agentOnline: false, pushed: 0 };
    const o = raw as Record<string, unknown>;
    return { agentOnline: o.agentOnline === true, pushed: num(o.pushed) };
  }

  private toNode(raw: unknown): IFileNode | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string') return null;
    return {
      path: o.path,
      size: num(o.size),
      updatedAt: str(o.updatedAt),
      kind: kind(o.kind),
      editable: o.editable === true,
    };
  }
}
