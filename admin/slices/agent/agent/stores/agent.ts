import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentService } from '#agent/domain';
import type {
  IAgentData,
  ICreateAgentData,
  IUpdateAgentData,
} from '#agent/domain';

// Re-export the domain types so consumers that import them from
// `#agent/stores/agent` (Form, agentList/agentCreate/agentEdit/agentVisibility
// Providers, rancher store, …) keep working.
export type {
  AgentStatusTypes,
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
  IAgentResources,
  ICreateAgentData,
  IUpdateAgentData,
} from '#agent/domain';

const getService = createServiceGetter<AgentService>('$agentService');

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
    agents.value = await getService().findAll();
    return agents.value;
  }

  function fetchById(id: string) {
    return getService().findById(id);
  }

  function fetchAdmin() {
    return getService().findAdmin();
  }

  async function create(data: ICreateAgentData) {
    const created = await getService().create(data);
    agents.value = [created, ...agents.value];
    return created;
  }

  async function update(id: string, data: IUpdateAgentData) {
    const updated = await getService().update(id, data);
    agents.value = agents.value.map((a) => (a.id === id ? updated : a));
    return updated;
  }

  // Optimistic: flip the status so the UI reacts immediately (the lifecycle
  // endpoints take several seconds). Revert on error.
  async function withOptimisticStatus(
    id: string,
    optimistic: IAgentData['status'],
    run: () => Promise<IAgentData>,
  ) {
    const previous = agents.value.find((a) => a.id === id);
    if (previous && previous.status !== optimistic) {
      agents.value = agents.value.map((a) =>
        a.id === id ? { ...a, status: optimistic } : a,
      );
    }
    try {
      const updated = await run();
      agents.value = agents.value.map((a) => (a.id === id ? updated : a));
      return updated;
    } catch (err) {
      if (previous) {
        agents.value = agents.value.map((a) => (a.id === id ? previous : a));
      }
      throw err;
    }
  }

  function restart(id: string) {
    return withOptimisticStatus(id, 'deploying', () => getService().restart(id));
  }

  function stop(id: string) {
    return withOptimisticStatus(id, 'stopped', () => getService().stop(id));
  }

  function start(id: string) {
    return withOptimisticStatus(id, 'deploying', () => getService().start(id));
  }

  async function remove(id: string, options: { wipeS3?: boolean } = {}) {
    await getService().remove(id, options.wipeS3 ?? false);
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  async function promoteAdmin(id: string) {
    const updated = await getService().promoteAdmin(id);
    // Single-admin invariant — local cache must mirror the server. Drop the
    // flag from any other agent so two badges never appear at once.
    agents.value = agents.value.map((a) =>
      a.id === id ? updated : { ...a, isAdmin: false },
    );
    return updated;
  }

  async function demoteAdmin(id: string) {
    const updated = await getService().demoteAdmin(id);
    agents.value = agents.value.map((a) => (a.id === id ? updated : a));
    return updated;
  }

  function fetchLogs(id: string): Promise<string> {
    return getService().logs(id);
  }

  function fetchEnv(id: string) {
    return getService().env(id);
  }

  function fetchMetrics(id: string) {
    return getService().metrics(id);
  }

  return {
    agents,
    fetchAll,
    fetchById,
    fetchAdmin,
    create,
    update,
    restart,
    stop,
    start,
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
