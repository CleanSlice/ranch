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

export interface IFileChunk {
  path: string;
  content: string;
  size: number;
  totalSize: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
  updatedAt: string;
}

export interface ISyncResult {
  agentOnline: boolean;
  pushed: number;
}

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
    const res = await FilesService.fileControllerList({ path: { agentId } });
    const env = res.data as ApiEnvelope<IFileNode[]> | undefined;
    nodes.value = env?.data ?? [];
    return nodes.value;
  }

  async function fetchContent(
    agentId: string,
    path: string,
    offset = 0,
    limit = INITIAL_CHUNK_BYTES,
  ): Promise<IFileChunk> {
    const res = await FilesService.fileControllerRead({
      path: { agentId },
      query: { path, offset, limit },
    });
    const env = res.data as ApiEnvelope<IFileChunk> | undefined;
    if (!env?.data) {
      throw new Error(
        (res as { error?: { message?: string } }).error?.message ??
          'Failed to load file',
      );
    }
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

  // Streams the agent's S3 prefix as a ZIP into a browser download.
  // Uses raw fetch (not the generated SDK) because the endpoint returns
  // raw bytes; we replicate the Bearer-token attachment that the SDK's
  // axios interceptor handles automatically — see api/plugins/apiBaseUrl.ts.
  async function downloadZip(agentId: string): Promise<void> {
    const runtime = useRuntimeConfig();
    const headers: Record<string, string> = {};
    const token = readAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(
      `${runtime.public.apiUrl}/agents/${agentId}/files/export`,
      { credentials: 'include', headers },
    );
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-${agentId}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function readAccessToken(): string | null {
    if (typeof document === 'undefined') return null;
    const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  return {
    nodes,
    fetchList,
    fetchContent,
    save,
    sync,
    downloadZip,
    isPendingRestart,
    markPendingRestart,
    clearPendingRestart,
  };
});
