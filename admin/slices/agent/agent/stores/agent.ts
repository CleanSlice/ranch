import { AgentsService, LogsService } from '#api/data';
import { client } from '#api/data/repositories/api/client.gen';

type ApiEnvelope<T> = { success: boolean; data: T };

/**
 * Hey API's axios client never throws by default — it returns
 * `{ data, error, response }`. Crucially, on a *network-level* failure (the
 * request never gets an HTTP response — CORS rejection, API down, blocked by
 * an extension) it sets `error` to an empty `{}`. That object is truthy but
 * has no `.message`, so a naive `error.message ?? 'fallback'` surfaces a
 * meaningless fallback and hides the real cause.
 *
 * This helper turns every failure mode into an Error that says what actually
 * happened, and returns the unwrapped `data` payload on success.
 */
function unwrapResponse<T>(res: unknown, action: string): T {
  const r = res as {
    data?: ApiEnvelope<T>;
    error?: unknown;
    response?: { status?: number };
  };
  const status = r.response?.status;
  const err = r.error;
  if (err !== undefined && err !== null) {
    const message = (err as { message?: string }).message;
    if (message) throw new Error(`${action} failed: ${message}`);
    if (status && status >= 400) {
      throw new Error(`${action} failed: HTTP ${status}`);
    }
    // Empty error + no status → the request never reached the API.
    throw new Error(
      `${action} failed: could not reach the API. Check that the API is ` +
        'running and that this app\'s origin is listed in CORS_ORIGIN.',
    );
  }
  const env = r.data;
  if (!env || env.success === false || env.data === undefined) {
    throw new Error(`${action} failed: the API returned no data.`);
  }
  return env.data;
}

export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

export interface IAgentResources {
  cpu: string;
  memory: string;
}

export interface IAgentMetrics {
  pod: {
    cpuMilli: number;
    memBytes: number;
    cpuLimitMilli: number;
    memLimitBytes: number;
  };
  node: {
    name: string;
    diskAvailBytes: number;
    diskCapacityBytes: number;
  };
}

export interface IAgentData {
  id: string;
  name: string;
  templateId: string;
  llmCredentialId: string | null;
  status: AgentStatusTypes;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  isPublic: boolean;
  allowedOrigins: string[];
  knowledgeIds: string[];
  isAdmin: boolean;
  debugEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateAgentData {
  name: string;
  templateId: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
  isAdmin?: boolean;
}

export interface IUpdateAgentData {
  name?: string;
  templateId?: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
  debugEnabled?: boolean;
}

const PENDING_RESTART_KEY = 'agent:pendingRestart';

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

// "Restart is happening right now" — distinct from pendingRestart (which is
// "settings changed, agent needs restart"). Persisted so the chat-loading
// overlay survives an F5 during the seconds between Restart click and the DB
// row flipping to status='deploying'. TTL caps the entry so a tab that
// crashed mid-restart doesn't pin the overlay forever.
const RESTART_IN_FLIGHT_KEY = 'agent:restartInFlight';
const RESTART_IN_FLIGHT_TTL_MS = 5 * 60_000;

function loadRestartInFlightFromStorage(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RESTART_IN_FLIGHT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const fresh: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ts === 'number' && now - ts < RESTART_IN_FLIGHT_TTL_MS) {
        fresh[id] = ts;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function saveRestartInFlightToStorage(state: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RESTART_IN_FLIGHT_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — give up silently
  }
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<IAgentData[]>([]);
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

  const restartInFlight = ref<Record<string, number>>(
    loadRestartInFlightFromStorage(),
  );

  // Pure read — no side effects, safe to call from a Vue computed. Expired
  // entries are filtered out on next page load (loadRestartInFlightFromStorage).
  function isRestartInFlight(agentId: string): boolean {
    const ts = restartInFlight.value[agentId];
    if (ts === undefined) return false;
    return Date.now() - ts < RESTART_IN_FLIGHT_TTL_MS;
  }

  function markRestartInFlight(agentId: string): void {
    restartInFlight.value = {
      ...restartInFlight.value,
      [agentId]: Date.now(),
    };
    saveRestartInFlightToStorage(restartInFlight.value);
  }

  function clearRestartInFlight(agentId: string): void {
    if (restartInFlight.value[agentId] === undefined) return;
    const next = { ...restartInFlight.value };
    delete next[agentId];
    restartInFlight.value = next;
    saveRestartInFlightToStorage(restartInFlight.value);
  }

  async function fetchAll() {
    const res = await AgentsService.agentControllerFindAll();
    const env = res.data as ApiEnvelope<IAgentData[]> | undefined;
    agents.value = env?.data ?? [];
    return agents.value;
  }

  async function fetchById(id: string) {
    const res = await AgentsService.agentControllerFindById({ path: { id } });
    const env = res.data as ApiEnvelope<IAgentData | null> | undefined;
    return env?.data ?? null;
  }

  async function fetchAdmin() {
    const res = await AgentsService.agentControllerFindAdmin();
    const env = res.data as ApiEnvelope<IAgentData | null> | undefined;
    return env?.data ?? null;
  }

  async function create(data: ICreateAgentData) {
    const res = await AgentsService.agentControllerCreate({ body: data });
    const env = res.data as ApiEnvelope<IAgentData>;
    agents.value = [env.data, ...agents.value];
    return env.data;
  }

  async function update(id: string, data: IUpdateAgentData) {
    const res = await AgentsService.agentControllerUpdate({
      path: { id },
      body: data,
    });
    const updated = unwrapResponse<IAgentData>(res, 'Agent update');
    agents.value = agents.value.map((a) => (a.id === id ? updated : a));
    return updated;
  }

  async function restart(id: string) {
    // Optimistic: flip the status to "deploying" so the UI reacts immediately
    // (the restart endpoint cancels the old workflow and submits a new one,
    // which can take several seconds). Revert on error.
    const previous = agents.value.find((a) => a.id === id);
    if (previous && previous.status !== 'deploying') {
      agents.value = agents.value.map((a) =>
        a.id === id ? { ...a, status: 'deploying' } : a,
      );
    }
    try {
      const res = await AgentsService.agentControllerRestart({ path: { id } });
      // Hey API axios returns `{ data, error, response }`. On non-2xx it leaves
      // `data` undefined and surfaces the body in `error`. Surface a meaningful
      // message instead of crashing on `env.data` access.
      const errBody = (res as { error?: { message?: string } }).error;
      if (errBody) {
        throw new Error(errBody.message ?? 'Restart failed');
      }
      const env = res.data as ApiEnvelope<IAgentData> | undefined;
      const updated = env?.data;
      if (!updated) {
        throw new Error('Restart returned no agent data');
      }
      agents.value = agents.value.map((a) => (a.id === id ? updated : a));
      return updated;
    } catch (err) {
      if (previous) {
        agents.value = agents.value.map((a) => (a.id === id ? previous : a));
      }
      throw err;
    }
  }

  async function remove(id: string, options: { wipeS3?: boolean } = {}) {
    // Use raw fetch because the OpenAPI spec doesn't yet expose `wipeS3`
    // as a typed query param. We re-attach the Bearer token from the
    // access_token cookie ourselves — same job the SDK's axios
    // interceptor does in api/plugins/apiBaseUrl.ts.
    const runtime = useRuntimeConfig();
    const url = new URL(`${runtime.public.apiUrl}/agents/${id}`);
    if (options.wipeS3) url.searchParams.set('wipeS3', 'true');
    const headers: Record<string, string> = {};
    const token = readAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url.toString(), {
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Delete failed: ${res.status} ${res.statusText}`);
    }
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  function readAccessToken(): string | null {
    if (typeof document === 'undefined') return null;
    const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function promoteAdmin(id: string) {
    const res = await AgentsService.agentControllerPromoteAdmin({ path: { id } });
    const env = res.data as ApiEnvelope<IAgentData> | undefined;
    const updated = env?.data;
    if (!updated) throw new Error('Promote returned no agent data');
    // Single-admin invariant — local cache must mirror the server. Drop the
    // flag from any other agent so two badges never appear at once.
    agents.value = agents.value.map((a) =>
      a.id === id ? updated : { ...a, isAdmin: false },
    );
    return updated;
  }

  async function demoteAdmin(id: string) {
    const res = await AgentsService.agentControllerDemoteAdmin({ path: { id } });
    const env = res.data as ApiEnvelope<IAgentData> | undefined;
    const updated = env?.data;
    if (!updated) throw new Error('Demote returned no agent data');
    agents.value = agents.value.map((a) => (a.id === id ? updated : a));
    return updated;
  }

  async function fetchLogs(id: string): Promise<string> {
    const res = await LogsService.logControllerGetLogs({ path: { agentId: id } });
    const env = res.data as ApiEnvelope<{ logs: string }> | undefined;
    return env?.data?.logs ?? '';
  }

  // Env preview — the API builds it with the same code as the real pod
  // manifest, so the admin panel can't drift. Raw axios call: the generated
  // SDK hasn't been regenerated for this endpoint yet.
  async function fetchEnv(
    id: string,
  ): Promise<{ name: string; value: string }[]> {
    const res = await client.instance.get(`/agents/${id}/env`);
    const env = res.data as
      | ApiEnvelope<{ name: string; value: string }[]>
      | undefined;
    return env?.data ?? [];
  }

  async function fetchMetrics(id: string): Promise<IAgentMetrics | null> {
    const res = await client.instance.get(`/agents/${id}/metrics`);
    const env = res.data as ApiEnvelope<IAgentMetrics | null> | undefined;
    return env?.data ?? null;
  }

  return {
    agents,
    fetchAll,
    fetchById,
    fetchAdmin,
    create,
    update,
    restart,
    remove,
    promoteAdmin,
    demoteAdmin,
    fetchLogs,
    fetchEnv,
    fetchMetrics,
    isPendingRestart,
    markPendingRestart,
    clearPendingRestart,
    isRestartInFlight,
    markRestartInFlight,
    clearRestartInFlight,
  };
});
