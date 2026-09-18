import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentService } from '#agent/domain';
import type {
  IAgentData,
  IClusterCapacityData,
  ICreateAgentData,
  IUpdateAgentData,
} from '#agent/domain';

// Re-export the domain types so consumers that import them from
// `#agent/stores/agent` (the components/agent/* Providers, rancher store, …)
// keep working.
export type {
  AgentStatusTypes,
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
  IAgentResources,
  IClusterCapacityData,
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
  // Single source of truth (docs/state.md): an agent lives here once. Every
  // fetch upserts into this collection, the status stream writes into it, and
  // components render `byId(id)` — never the value a fetch handed back. A
  // list row and a detail header are then the same object and cannot disagree.
  const agents = ref<IAgentData[]>([]);

  // Plain lookup — reactive when read inside a computed.
  function byId(id: string): IAgentData | undefined {
    return agents.value.find((a) => a.id === id);
  }

  // Full records only (anything the API returned for one agent): replaces the
  // row in place so the list keeps its order, appends when the id is new.
  function upsert(agent: IAgentData): IAgentData {
    agents.value = agents.value.some((a) => a.id === agent.id)
      ? agents.value.map((a) => (a.id === agent.id ? agent : a))
      : [...agents.value, agent];
    return agent;
  }

  // Partial change to a known record — the one road for optimistic flips.
  // Returns a rollback that restores only the fields still holding the patched
  // value: if a fetch or a stream frame wrote something fresher in between,
  // undoing the guess must not undo the truth.
  function patch(id: string, partial: Partial<IAgentData>): () => void {
    const previous = byId(id);
    if (!previous) return () => {};
    agents.value = agents.value.map((a) =>
      a.id === id ? { ...a, ...partial } : a,
    );
    return () => {
      const current = byId(id);
      if (!current) return;
      const restored: Record<string, unknown> = {};
      for (const key of Object.keys(partial) as (keyof IAgentData)[]) {
        if (current[key] === partial[key]) restored[key] = previous[key];
      }
      agents.value = agents.value.map((a) =>
        a.id === id ? { ...a, ...(restored as Partial<IAgentData>) } : a,
      );
    };
  }

  // The whole collection at once — `fetchAll` and the stream's snapshot.
  function setAll(list: IAgentData[]): void {
    agents.value = list;
  }

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
    setAll(await getService().findAll());
    return agents.value;
  }

  const capacity = ref<IClusterCapacityData | null>(null);

  // Silent degradation on purpose: K8s unreachable or a network failure both
  // mean "no number to show" — never an error banner.
  async function fetchCapacity() {
    try {
      capacity.value = await getService().capacity();
    } catch {
      capacity.value = null;
    }
    return capacity.value;
  }

  async function fetchById(id: string) {
    const agent = await getService().findById(id);
    return agent ? upsert(agent) : agent;
  }

  async function fetchAdmin() {
    const agent = await getService().findAdmin();
    return agent ? upsert(agent) : agent;
  }

  async function create(data: ICreateAgentData) {
    const created = await getService().create(data);
    agents.value = [created, ...agents.value];
    // Fire-and-forget: the new agent reserves a slot server-side the moment
    // create returns, so a refetch already sees the counter drop.
    void fetchCapacity();
    return created;
  }

  async function update(id: string, data: IUpdateAgentData) {
    return upsert(await getService().update(id, data));
  }

  // Optimistic: flip the status so the UI reacts immediately (the lifecycle
  // endpoints take several seconds). Revert on error. Because every screen
  // renders this record, callers need no optimistic copy of their own.
  async function withOptimisticStatus(
    id: string,
    optimistic: IAgentData['status'],
    run: () => Promise<IAgentData>,
  ) {
    const rollback = patch(id, { status: optimistic });
    try {
      return upsert(await run());
    } catch (err) {
      rollback();
      throw err;
    }
  }

  async function restart(id: string) {
    const updated = await withOptimisticStatus(id, 'deploying', () =>
      getService().restart(id),
    );
    void fetchCapacity();
    return updated;
  }

  async function stop(id: string) {
    const updated = await withOptimisticStatus(id, 'stopped', () =>
      getService().stop(id),
    );
    void fetchCapacity();
    return updated;
  }

  async function start(id: string) {
    const updated = await withOptimisticStatus(id, 'deploying', () =>
      getService().start(id),
    );
    void fetchCapacity();
    return updated;
  }

  async function remove(id: string, options: { wipeS3?: boolean } = {}) {
    await getService().remove(id, options.wipeS3 ?? false);
    agents.value = agents.value.filter((a) => a.id !== id);
    void fetchCapacity();
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
    return upsert(await getService().demoteAdmin(id));
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
    byId,
    upsert,
    patch,
    setAll,
    capacity,
    fetchAll,
    fetchCapacity,
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
