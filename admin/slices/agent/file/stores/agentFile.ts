import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentFileService,
  IFileChunk,
  IFileContent,
  IFileNode,
} from '#agentFile/domain';

// Re-export the domain types so `agentFile/Tree.vue` (and any future consumer
// importing from `#agentFile/stores/agentFile`) keeps working.
export type {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISyncResult,
} from '#agentFile/domain';

const getService = createServiceGetter<AgentFileService>('$agentFileService');

// First-chunk size (matches the server default and the old editor cap).
// Picked so that small files come back in a single round-trip, while large
// files don't hang the UI on the initial open.
const INITIAL_CHUNK_BYTES = 256 * 1024;

const PENDING_RESTART_KEY = 'agentFile:pendingRestart';

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

export const useAgentFileStore = defineStore('agentFile', () => {
  const nodes = ref<IFileNode[]>([]);
  const pendingRestart = ref<Record<string, true>>(
    loadPendingRestartFromStorage(),
  );

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

  async function fetchList(agentId: string) {
    nodes.value = await getService().list(agentId);
    return nodes.value;
  }

  function fetchContent(
    agentId: string,
    path: string,
    offset = 0,
    limit = INITIAL_CHUNK_BYTES,
  ): Promise<IFileChunk> {
    return getService().read(agentId, path, offset, limit);
  }

  async function save(
    agentId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    const updated = await getService().save(agentId, path, content);
    nodes.value = nodes.value.map((n) =>
      n.path === path
        ? { path: n.path, size: updated.size, updatedAt: updated.updatedAt }
        : n,
    );
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
    const folderPrefix = path.endsWith('/') ? path : path + '/';
    nodes.value = nodes.value.filter((n) =>
      recursive
        ? n.path !== path && !n.path.startsWith(folderPrefix)
        : n.path !== path,
    );
    markPendingRestart(agentId);
    return deleted;
  }

  function sync(agentId: string) {
    return getService().sync(agentId);
  }

  // Streams the agent's S3 prefix as a ZIP into a browser download.
  async function downloadZip(agentId: string): Promise<void> {
    const blob = await getService().exportZip(agentId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-${agentId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    nodes,
    fetchList,
    fetchContent,
    save,
    remove,
    sync,
    downloadZip,
    isPendingRestart,
    markPendingRestart,
    clearPendingRestart,
  };
});
