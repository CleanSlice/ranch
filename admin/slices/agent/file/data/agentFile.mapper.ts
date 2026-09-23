import type {
  FileKind,
  IFileChangeProposal,
  IFileChunk,
  IFileContent,
  IFileLimits,
  IFileNode,
  IImportPlan,
  IImportPlanEntry,
  IImportResult,
  IProposalSetSummary,
  ISyncResult,
  ImportAction,
  ProposalStatus,
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

  toImportPlan(raw: unknown): IImportPlan | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.importId !== 'string') return null;
    const counts = (o.counts && typeof o.counts === 'object' ? o.counts : {}) as Record<
      string,
      unknown
    >;
    return {
      importId: o.importId,
      mode: o.mode === 'replace' ? 'replace' : 'merge',
      includeSessions: o.includeSessions === true,
      wrapperStripped: typeof o.wrapperStripped === 'string' ? o.wrapperStripped : null,
      counts: {
        add: num(counts.add),
        change: num(counts.change),
        unchanged: num(counts.unchanged),
        remove: num(counts.remove),
        skip: num(counts.skip),
      },
      totalBytes: num(o.totalBytes),
      entries: Array.isArray(o.entries)
        ? o.entries
            .map((e) => this.toImportEntry(e))
            .filter((e): e is IImportPlanEntry => e !== null)
        : [],
      more: num(o.more),
      warnings: Array.isArray(o.warnings)
        ? o.warnings.filter((w): w is string => typeof w === 'string')
        : [],
    };
  }

  toImportResult(raw: unknown): IImportResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.importId !== 'string') return null;
    return {
      importId: o.importId,
      mode: o.mode === 'replace' ? 'replace' : 'merge',
      written: num(o.written),
      removed: num(o.removed),
      skipped: num(o.skipped),
      failed: Array.isArray(o.failed)
        ? o.failed
            .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
            .map((f) => ({ path: str(f.path), reason: str(f.reason) }))
        : [],
      restartRequired: o.restartRequired === true,
    };
  }

  toProposalList(raw: unknown): IFileChangeProposal[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p) => this.toProposal(p))
      .filter((p): p is IFileChangeProposal => p !== null);
  }

  toProposal(raw: unknown): IFileChangeProposal | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    const statuses: ProposalStatus[] = ['pending', 'applied', 'skipped', 'stale', 'refused'];
    const status = statuses.includes(o.status as ProposalStatus)
      ? (o.status as ProposalStatus)
      : 'pending';
    const summaryRaw = o.summary && typeof o.summary === 'object' ? (o.summary as Record<string, unknown>) : null;
    const counts = (summaryRaw?.counts && typeof summaryRaw.counts === 'object' ? summaryRaw.counts : {}) as Record<string, unknown>;
    const summary: IProposalSetSummary | null = summaryRaw
      ? {
          counts: {
            add: num(counts.add),
            change: num(counts.change),
            unchanged: num(counts.unchanged),
            remove: num(counts.remove),
            skip: num(counts.skip),
          },
          rows: Array.isArray(summaryRaw.rows)
            ? summaryRaw.rows
                .map((e) => this.toImportEntry(e))
                .filter((e): e is IImportPlanEntry => e !== null)
            : [],
          more: num(summaryRaw.more),
          mode: summaryRaw.mode === 'replace' ? 'replace' : 'merge',
          includeSessions: summaryRaw.includeSessions === true,
        }
      : null;
    const nullableNum = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      id: o.id,
      agentId: str(o.agentId),
      agentName: str(o.agentName) || str(o.agentId),
      chatAgentId: str(o.chatAgentId),
      channel: str(o.channel) || 'admin',
      kind: o.kind === 'set' ? 'set' : 'single',
      op: o.op === 'create' ? 'create' : o.op === 'import' ? 'import' : 'write',
      path: nullableStr(o.path),
      proposedBytes: num(o.proposedBytes),
      diffStatus:
        o.diffStatus === 'too_large' || o.diffStatus === 'binary' || o.diffStatus === 'none'
          ? o.diffStatus
          : 'ok',
      additions: nullableNum(o.additions),
      deletions: nullableNum(o.deletions),
      changedLines: nullableNum(o.changedLines),
      firstChangedLine: nullableNum(o.firstChangedLine),
      inlineDiff: nullableStr(o.inlineDiff),
      summary,
      status,
      actedBy: nullableStr(o.actedBy),
      actedVia:
        o.actedVia === 'card' || o.actedVia === 'tool' || o.actedVia === 'editor' ? o.actedVia : null,
      actedAt: nullableStr(o.actedAt),
      result: (o.result && typeof o.result === 'object' ? o.result : null) as IFileChangeProposal['result'],
      restartRequired: o.restartRequired === true,
      createdAt: str(o.createdAt),
      reason: nullableStr(o.reason),
    };
  }

  private toImportEntry(raw: unknown): IImportPlanEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string') return null;
    const action = o.action;
    const actions: ImportAction[] = ['add', 'change', 'unchanged', 'remove', 'skip'];
    return {
      path: o.path,
      action: actions.includes(action as ImportAction) ? (action as ImportAction) : 'unchanged',
      size: num(o.size),
      reason: typeof o.reason === 'string' ? o.reason : undefined,
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
