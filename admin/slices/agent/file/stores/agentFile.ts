import { FilesService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface IFileNode {
  path: string;
  size: number;
  updatedAt: string;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
}

export interface ISyncResult {
  agentOnline: boolean;
  pushed: number;
}

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
    const res = await FilesService.fileControllerList({ path: { agentId } });
    const env = res.data as ApiEnvelope<IFileNode[]> | undefined;
    nodes.value = env?.data ?? [];
    return nodes.value;
  }

  async function fetchContent(agentId: string, path: string): Promise<IFileContent> {
    const res = await FilesService.fileControllerRead({
      path: { agentId },
      query: { path },
    });
    const env = res.data as ApiEnvelope<IFileContent>;
    return env.data;
  }

  async function save(
    agentId: string,
    path: string,
    content: string,
  ): Promise<IFileContent> {
    const res = await FilesService.fileControllerSave({
      path: { agentId },
      query: { path },
      body: { content },
    });
    const env = res.data as ApiEnvelope<IFileContent>;
    const updated = env.data;
    nodes.value = nodes.value.map((n) =>
      n.path === path
        ? { path: n.path, size: updated.size, updatedAt: updated.updatedAt }
        : n,
    );
    markPendingRestart(agentId);
    return updated;
  }

  async function sync(agentId: string): Promise<ISyncResult> {
    const res = await FilesService.fileControllerSync({ path: { agentId } });
    const env = res.data as ApiEnvelope<ISyncResult> | undefined;
    return env?.data ?? { agentOnline: false, pushed: 0 };
  }

  return {
    nodes,
    fetchList,
    fetchContent,
    save,
    sync,
    isPendingRestart,
    markPendingRestart,
    clearPendingRestart,
  };
});
