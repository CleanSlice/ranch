import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentFileService,
  FileKind,
  IDeleteOutcome,
  IFileChunk,
  IFileContent,
  IFileLimits,
  IFileNode,
  IImportApplyOptions,
  IImportApplyOutcome,
  IImportPlan,
  ISaveOptions,
  ImportMode,
} from '#agentFile/domain';

// Re-export the domain types so components importing from
// `#agentFile/stores/agentFile` keep working.
export type {
  IFileChunk,
  IFileContent,
  IFileLimits,
  IFileNode,
  ISyncResult,
} from '#agentFile/domain';

import { closeTab as closeTabUtil, openTab as openTabUtil } from '#agentFile/utils/tabs';

const getService = createServiceGetter<AgentFileService>('$agentFileService');

const PENDING_RESTART_KEY = 'agentFile:pendingRestart';

/** What the viewer/editor has of one file (CLEAN-112): slices so far + facts. */
export interface ILoadedFile {
  path: string;
  content: string;
  totalSize: number;
  nextOffset: number | null;
  hasMore: boolean;
  kind: FileKind;
  editable: boolean;
  updatedAt: string;
  loading: boolean;
  error: string | null;
}

/** An unsaved edit; `baseUpdatedAt` is what the editor loaded (for 412). */
export interface IDraft {
  content: string;
  baseUpdatedAt: string;
  /** Set when the draft came from a chat proposal (Edit before applying). */
  proposalId?: string;
}

function loadPendingRestartFromStorage(): Record<string, true> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PENDING_RESTART_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, true>;
    }
  } catch {
    // ignore corrupted storage
  }
  return {};
}

function savePendingRestartToStorage(state: Record<string, true>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PENDING_RESTART_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — give up silently
  }
}

/**
 * One entity, one store (docs/state.md): the file list, the loaded slices,
 * the drafts, the open tabs and the selection all live here keyed by agent,
 * so components render by `agentId` + `path` and survive re-mounts.
 */
export const useAgentFileStore = defineStore('agentFile', () => {
  const limits = ref<IFileLimits | null>(null);
  const filesByAgent = ref<Record<string, IFileNode[]>>({});
  const loaded = ref<Record<string, Record<string, ILoadedFile>>>({});
  const drafts = ref<Record<string, Record<string, IDraft>>>({});
  const openTabs = ref<Record<string, string[]>>({});
  const activePath = ref<Record<string, string | null>>({});
  const selection = ref<Record<string, string[]>>({});
  const pendingRestart = ref<Record<string, true>>(
    loadPendingRestartFromStorage(),
  );

  // ── Pending restart (unchanged behaviour) ───────────────────────

  function isPendingRestart(agentId: string): boolean {
    return pendingRestart.value[agentId] === true;
  }

  function markPendingRestart(agentId: string): void {
    pendingRestart.value = { ...pendingRestart.value, [agentId]: true };
    savePendingRestartToStorage(pendingRestart.value);
  }

  function clearPendingRestart(agentId: string): void {
    if (!pendingRestart.value[agentId]) return;
    const next = { ...pendingRestart.value };
    delete next[agentId];
    pendingRestart.value = next;
    savePendingRestartToStorage(pendingRestart.value);
  }

  // ── Limits and list ─────────────────────────────────────────────

  async function fetchLimits(agentId: string): Promise<IFileLimits> {
    if (limits.value) return limits.value;
    limits.value = await getService().limits(agentId);
    return limits.value;
  }

  function nodesFor(agentId: string): IFileNode[] {
    return filesByAgent.value[agentId] ?? [];
  }

  function nodeFor(agentId: string, path: string): IFileNode | null {
    return nodesFor(agentId).find((n) => n.path === path) ?? null;
  }

  async function fetchList(agentId: string): Promise<IFileNode[]> {
    const list = await getService().list(agentId);
    filesByAgent.value = { ...filesByAgent.value, [agentId]: list };
    // Tabs whose file vanished (delete, import, sync) close themselves.
    const present = new Set(list.map((n) => n.path));
    const tabs = (openTabs.value[agentId] ?? []).filter((p) => present.has(p));
    if (tabs.length !== (openTabs.value[agentId] ?? []).length) {
      openTabs.value = { ...openTabs.value, [agentId]: tabs };
      if (activePath.value[agentId] && !present.has(activePath.value[agentId]!)) {
        activePath.value = { ...activePath.value, [agentId]: tabs[0] ?? null };
      }
    }
    const sel = (selection.value[agentId] ?? []).filter((p) => present.has(p));
    selection.value = { ...selection.value, [agentId]: sel };
    return list;
  }

  function upsertNode(agentId: string, node: IFileNode): void {
    const list = nodesFor(agentId);
    const next = list.some((n) => n.path === node.path)
      ? list.map((n) => (n.path === node.path ? node : n))
      : [...list, node].sort((a, b) => a.path.localeCompare(b.path));
    filesByAgent.value = { ...filesByAgent.value, [agentId]: next };
  }

  // ── Loaded slices ───────────────────────────────────────────────

  function loadedFor(agentId: string, path: string): ILoadedFile | null {
    return loaded.value[agentId]?.[path] ?? null;
  }

  function setLoaded(agentId: string, path: string, file: ILoadedFile): void {
    loaded.value = {
      ...loaded.value,
      [agentId]: { ...(loaded.value[agentId] ?? {}), [path]: file },
    };
  }

  function fromChunk(chunk: IFileChunk, previous?: ILoadedFile | null): ILoadedFile {
    return {
      path: chunk.path,
      content: (previous?.content ?? '') + chunk.content,
      totalSize: chunk.totalSize,
      nextOffset: chunk.nextOffset,
      hasMore: chunk.hasMore,
      kind: chunk.kind,
      editable: chunk.editable,
      updatedAt: chunk.updatedAt,
      loading: false,
      error: null,
    };
  }

  /** Load (or reload) the first slice of a file. */
  async function fetchContent(
    agentId: string,
    path: string,
    force = false,
  ): Promise<ILoadedFile> {
    const existing = loadedFor(agentId, path);
    if (existing && !force && !existing.error) return existing;
    const lim = await fetchLimits(agentId);
    setLoaded(agentId, path, {
      path,
      content: '',
      totalSize: 0,
      nextOffset: null,
      hasMore: false,
      kind: 'text',
      editable: false,
      updatedAt: '',
      loading: true,
      error: null,
    });
    try {
      const chunk = await getService().read(agentId, path, 0, lim.rangeBytes);
      const file = fromChunk(chunk);
      setLoaded(agentId, path, file);
      return file;
    } catch (err) {
      const failed: ILoadedFile = {
        ...(loadedFor(agentId, path) as ILoadedFile),
        loading: false,
        error: (err as Error).message || 'Failed to load file',
      };
      setLoaded(agentId, path, failed);
      return failed;
    }
  }

  /** Append the next slice; no-op when nothing is left or a fetch is running. */
  async function fetchMore(agentId: string, path: string): Promise<ILoadedFile | null> {
    const current = loadedFor(agentId, path);
    if (!current || !current.hasMore || current.nextOffset === null || current.loading) {
      return current;
    }
    const lim = await fetchLimits(agentId);
    setLoaded(agentId, path, { ...current, loading: true });
    try {
      const chunk = await getService().read(agentId, path, current.nextOffset, lim.rangeBytes);
      const file = fromChunk(chunk, current);
      setLoaded(agentId, path, file);
      return file;
    } catch (err) {
      setLoaded(agentId, path, {
        ...current,
        loading: false,
        error: (err as Error).message || 'Failed to load more',
      });
      return loadedFor(agentId, path);
    }
  }

  function forget(agentId: string, path: string): void {
    const byAgent = { ...(loaded.value[agentId] ?? {}) };
    delete byAgent[path];
    loaded.value = { ...loaded.value, [agentId]: byAgent };
  }

  // ── Drafts ──────────────────────────────────────────────────────

  function draftFor(agentId: string, path: string): IDraft | null {
    return drafts.value[agentId]?.[path] ?? null;
  }

  function isDirty(agentId: string, path: string): boolean {
    const d = draftFor(agentId, path);
    if (!d) return false;
    const l = loadedFor(agentId, path);
    return !l || d.content !== l.content;
  }

  function dirtyPaths(agentId: string): string[] {
    return Object.keys(drafts.value[agentId] ?? {}).filter((p) => isDirty(agentId, p));
  }

  function setDraft(agentId: string, path: string, content: string, proposalId?: string): void {
    const l = loadedFor(agentId, path);
    const previous = draftFor(agentId, path);
    drafts.value = {
      ...drafts.value,
      [agentId]: {
        ...(drafts.value[agentId] ?? {}),
        [path]: {
          content,
          baseUpdatedAt: previous?.baseUpdatedAt ?? l?.updatedAt ?? '',
          proposalId: proposalId ?? previous?.proposalId,
        },
      },
    };
  }

  function clearDraft(agentId: string, path: string): void {
    const byAgent = { ...(drafts.value[agentId] ?? {}) };
    delete byAgent[path];
    drafts.value = { ...drafts.value, [agentId]: byAgent };
  }

  // ── Tabs ────────────────────────────────────────────────────────

  function tabsFor(agentId: string): string[] {
    return openTabs.value[agentId] ?? [];
  }

  function activeFor(agentId: string): string | null {
    return activePath.value[agentId] ?? null;
  }

  function activate(agentId: string, path: string | null): void {
    activePath.value = { ...activePath.value, [agentId]: path };
  }

  /** Open a file in a tab (loading its first slice) and make it active. */
  async function open(agentId: string, path: string): Promise<ILoadedFile> {
    openTabs.value = { ...openTabs.value, [agentId]: openTabUtil(tabsFor(agentId), path) };
    activate(agentId, path);
    return fetchContent(agentId, path);
  }

  function closeTab(agentId: string, path: string): void {
    const result = closeTabUtil(tabsFor(agentId), path, activeFor(agentId));
    openTabs.value = { ...openTabs.value, [agentId]: result.tabs };
    clearDraft(agentId, path);
    activate(agentId, result.active);
  }

  // ── Selection ───────────────────────────────────────────────────

  function selectionFor(agentId: string): string[] {
    return selection.value[agentId] ?? [];
  }

  function setSelection(agentId: string, paths: string[]): void {
    selection.value = { ...selection.value, [agentId]: [...new Set(paths)] };
  }

  function clearSelection(agentId: string): void {
    setSelection(agentId, []);
  }

  // ── Writes ──────────────────────────────────────────────────────

  /**
   * Save the current draft (or explicit content). Throws `SaveRefusedError`
   * for 409 / 412 / 400 so the caller can offer reload / overwrite.
   */
  async function save(
    agentId: string,
    path: string,
    content?: string,
    options: ISaveOptions & { overwrite?: boolean } = {},
  ): Promise<IFileContent> {
    const draft = draftFor(agentId, path);
    const body = content ?? draft?.content ?? '';
    const base = draft?.baseUpdatedAt || loadedFor(agentId, path)?.updatedAt || '';
    const updated = await getService().save(agentId, path, body, {
      createOnly: options.createOnly,
      ifUnmodifiedSince: options.overwrite || options.createOnly ? undefined : base || undefined,
    });
    upsertNode(agentId, {
      path: updated.path,
      size: updated.size,
      updatedAt: updated.updatedAt,
      kind: updated.kind,
      editable: updated.editable,
    });
    setLoaded(agentId, path, {
      path,
      content: updated.content,
      totalSize: updated.size,
      nextOffset: null,
      hasMore: false,
      kind: updated.kind,
      editable: updated.editable,
      updatedAt: updated.updatedAt,
      loading: false,
      error: null,
    });
    clearDraft(agentId, path);
    markPendingRestart(agentId);
    return updated;
  }

  // Deletes a single file, or a whole folder when `recursive` is true
  // (e.g. a skill dir under `skills/`). Returns the number of S3 objects
  // deleted and prunes the local tree so the UI updates without a refetch.
  async function remove(
    agentId: string,
    path: string,
    recursive = false,
  ): Promise<number> {
    const deleted = await getService().remove(agentId, path, recursive);
    pruneLocal(agentId, [path], recursive);
    markPendingRestart(agentId);
    return deleted;
  }

  /** Bulk delete (CLEAN-112). A 'conflict' outcome deleted nothing. */
  async function removeMany(
    agentId: string,
    paths: string[],
    confirm = false,
  ): Promise<IDeleteOutcome> {
    const outcome = await getService().removeMany(agentId, paths, confirm);
    if (outcome.status === 'done') {
      pruneLocal(agentId, paths, true);
      markPendingRestart(agentId);
    }
    return outcome;
  }

  function pruneLocal(agentId: string, paths: string[], recursive: boolean): void {
    const covered = (p: string): boolean =>
      paths.some((w) => p === w || (recursive && p.startsWith(w.endsWith('/') ? w : w + '/')));
    filesByAgent.value = {
      ...filesByAgent.value,
      [agentId]: nodesFor(agentId).filter((n) => !covered(n.path)),
    };
    for (const p of tabsFor(agentId)) if (covered(p)) closeTab(agentId, p);
    for (const p of Object.keys(loaded.value[agentId] ?? {})) if (covered(p)) forget(agentId, p);
    setSelection(agentId, selectionFor(agentId).filter((p) => !covered(p)));
  }

  function sync(agentId: string, confirm?: boolean) {
    return getService().sync(agentId, confirm);
  }

  // ── Import (CLEAN-112) ──────────────────────────────────────────

  function stageImport(
    agentId: string,
    archive: File,
    onProgress?: (percent: number) => void,
  ): Promise<IImportPlan> {
    return getService().stageImport(agentId, archive, onProgress);
  }

  function planImport(
    agentId: string,
    importId: string,
    mode: ImportMode,
    includeSessions: boolean,
  ): Promise<IImportPlan> {
    return getService().planImport(agentId, importId, mode, includeSessions);
  }

  /** Apply a staged archive; on success the list is refetched and a restart is pending. */
  async function applyImport(
    agentId: string,
    importId: string,
    options: IImportApplyOptions,
  ): Promise<IImportApplyOutcome> {
    const outcome = await getService().applyImport(agentId, importId, options);
    if (outcome.status === 'done') {
      // Drafts survive; loaded slices are stale for anything the import wrote.
      for (const p of Object.keys(loaded.value[agentId] ?? {})) {
        if (!draftFor(agentId, p)) forget(agentId, p);
      }
      await fetchList(agentId);
      for (const p of tabsFor(agentId)) {
        if (!draftFor(agentId, p) && nodeFor(agentId, p)?.kind === 'text') {
          void fetchContent(agentId, p, true);
        }
      }
      markPendingRestart(agentId);
    }
    return outcome;
  }

  /** Open the raw stored file in a new tab through a short-lived link. */
  async function openFull(agentId: string, path: string): Promise<void> {
    const link = await getService().openLink(agentId, path);
    // The API returns a path when it has no public URL configured.
    const runtime = useRuntimeConfig();
    const url = link.url.startsWith('/')
      ? `${String(runtime.public.apiUrl).replace(/\/$/, '')}${link.url}`
      : link.url;
    window.open(url, '_blank', 'noopener');
  }

  // Streams the agent's S3 prefix (or a selection) as a ZIP into a download.
  async function downloadZip(agentId: string, paths?: string[]): Promise<void> {
    const blob = await getService().exportZip(agentId, paths);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = paths?.length ? `agent-${agentId}-selection.zip` : `agent-${agentId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    limits,
    filesByAgent,
    loaded,
    drafts,
    openTabs,
    activePath,
    selection,
    fetchLimits,
    nodesFor,
    nodeFor,
    fetchList,
    upsertNode,
    loadedFor,
    fetchContent,
    fetchMore,
    forget,
    draftFor,
    isDirty,
    dirtyPaths,
    setDraft,
    clearDraft,
    tabsFor,
    activeFor,
    activate,
    open,
    closeTab,
    selectionFor,
    setSelection,
    clearSelection,
    save,
    remove,
    removeMany,
    sync,
    openFull,
    stageImport,
    planImport,
    applyImport,
    downloadZip,
    isPendingRestart,
    markPendingRestart,
    clearPendingRestart,
  };
});
