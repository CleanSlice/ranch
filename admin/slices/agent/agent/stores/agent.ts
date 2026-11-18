import { createServiceGetter } from '#common/composables/createServiceGetter';
import { keepKnownCreator } from '#agent/utils/agentCreator';
import { useAuthStore } from '#auth/stores/auth';
import {
  agentPendingRestartKey,
  agentRestartInFlightKey,
} from '#bridle/utils/storageKeys';
import type { AgentService } from '#agent/domain';
import type {
  IAgentData,
  IAgentLogSummary,
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

// Whose restart marks the browser keeps (CLEAN-231): the maps below are
// keyed by agent id, so they name agents, and two people on one browser each
// have their own. The keys are built in `#bridle/utils/storageKeys`; with
// nobody signed in there is no key, and nothing is read or written.
function accountId(): string | null {
  return useAuthStore().user?.id ?? null;
}

function loadPendingRestartFromStorage(): Record<string, true> {
  if (typeof window === 'undefined') return {};
  const storageKey = agentPendingRestartKey(accountId());
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
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
  const storageKey = agentPendingRestartKey(accountId());
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // quota exceeded — give up silently
  }
}

// "Restart is happening right now" — distinct from pendingRestart (which is
// "settings changed, agent needs restart"). Persisted so the chat-loading
// overlay survives an F5 during the seconds between Restart click and the DB
// row flipping to status='deploying'. TTL caps the entry so a tab that
// crashed mid-restart doesn't pin the overlay forever.
const RESTART_IN_FLIGHT_TTL_MS = 5 * 60_000;

function loadRestartInFlightFromStorage(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  const storageKey = agentRestartInFlightKey(accountId());
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
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
  const storageKey = agentRestartInFlightKey(accountId());
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
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
  // Bumped by `resetForAccount`: the answer to a request that was open when
  // the account changed is about the previous account and is dropped.
  let accountGeneration = 0;

  // Plain lookup — reactive when read inside a computed.
  function byId(id: string): IAgentData | undefined {
    return agents.value.find((a) => a.id === id);
  }

  // One field a full record may not carry: who created the agent. A frame of
  // the status stream never says, and must not wipe what GET /agents said.
  function withKnownCreator(agent: IAgentData): IAgentData {
    return keepKnownCreator(agent, byId(agent.id));
  }

  // Full records only (anything the API returned for one agent): replaces the
  // row in place so the list keeps its order, appends when the id is new.
  function upsert(incoming: IAgentData): IAgentData {
    const agent = withKnownCreator(incoming);
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
        // Unwrapped: an array or object field is read back through Vue's
        // reactive wrapper, which is never `===` the value that was patched
        // in, so a refused change to such a field was not rolled back.
        if (toRaw(current[key]) === toRaw(partial[key])) restored[key] = previous[key];
      }
      agents.value = agents.value.map((a) =>
        a.id === id ? { ...a, ...(restored as Partial<IAgentData>) } : a,
      );
    };
  }

  // The whole collection at once — `fetchAll` and the stream's snapshot.
  function setAll(list: IAgentData[]): void {
    agents.value = list.map(withKnownCreator);
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

  // Throws when the list could not be read (CLEAN-231): a refused or
  // unreachable list is not an empty one, and the collection is left as it
  // is. Every caller either hands this to `useAsyncData`, which keeps the
  // error, or catches it.
  async function fetchAll() {
    const generation = accountGeneration;
    const list = await getService().findAll();
    if (generation === accountGeneration) setAll(list);
    return agents.value;
  }

  // The API says this account does not reach the agent any more (the hub's
  // `AGENT_NOT_FOUND` on an open chat, CLEAN-231): the record goes, so no
  // list offers it. Not a delete: nothing is asked of the server.
  function forget(id: string): void {
    if (!byId(id)) return;
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  const capacity = ref<IClusterCapacityData | null>(null);

  // Whether this account reaches the Ranch admin agent, the assistant behind
  // the "Rancher" entry (CLEAN-231). 'unknown' until `fetchAdmin` has an
  // answer; 'absent' when the installation has none yet (the Owner deploys
  // it from that entry); 'hidden' when the API answered 404, which it does
  // for an account whose access lists do not include the agent.
  const adminReach = ref<'unknown' | 'reached' | 'absent' | 'hidden'>('unknown');

  // Whoever was signed in is not any more (CLEAN-231): the agents read for
  // them go, so the next account's first screen is its own list. The ONE way
  // this store is emptied for an account change (docs/state.md). The restart
  // marks are read again: they are kept per account, and this runs once the
  // signed-in id has changed, so what comes back is the new account's own
  // (nothing, while nobody is signed in).
  function resetForAccount() {
    accountGeneration += 1;
    agents.value = [];
    capacity.value = null;
    adminReach.value = 'unknown';
    adminReachRequest = null;
    pendingRestart.value = loadPendingRestartFromStorage();
    restartInFlight.value = loadRestartInFlightFromStorage();
  }

  // Silent degradation on purpose: K8s unreachable or a network failure both
  // mean "no number to show" — never an error banner.
  async function fetchCapacity() {
    const generation = accountGeneration;
    try {
      const next = await getService().capacity();
      if (generation === accountGeneration) capacity.value = next;
    } catch {
      if (generation === accountGeneration) capacity.value = null;
    }
    return capacity.value;
  }

  async function fetchById(id: string) {
    const generation = accountGeneration;
    const agent = await getService().findById(id);
    if (generation !== accountGeneration) return null;
    return agent ? upsert(agent) : agent;
  }

  // Asked once per account, by the layout. Never throws: a 404 is an answer
  // ('hidden'), and any other failure leaves the reach unknown, which the
  // layout treats as "show the entry", as it did before this was asked.
  // The answer is kept, so nothing asks a second time and gets a second 404.
  let adminReachRequest: Promise<unknown> | null = null;

  // The layout and the Rancher page both need the answer, and may ask in the
  // same moment: one request serves both, and a known answer asks nothing.
  async function ensureAdminReach() {
    if (adminReach.value !== 'unknown') return adminReach.value;
    const generation = accountGeneration;
    if (!adminReachRequest) {
      const request = fetchAdmin().finally(() => {
        if (adminReachRequest === request) adminReachRequest = null;
      });
      adminReachRequest = request;
    }
    await adminReachRequest;
    // The account changed while this was asked: the answer was the previous
    // account's and was dropped; the caller is told nothing is known.
    return generation === accountGeneration ? adminReach.value : 'unknown';
  }

  async function fetchAdmin() {
    const generation = accountGeneration;
    try {
      const agent = await getService().findAdmin();
      if (generation !== accountGeneration) return null;
      adminReach.value = agent ? 'reached' : 'absent';
      // A known row is refreshed; an unknown one is left to the list read,
      // so the rail is never drawn with this one agent alone in it.
      return agent && byId(agent.id) ? upsert(agent) : agent;
    } catch (err) {
      if (
        generation === accountGeneration &&
        (err as { status?: number } | null)?.status === 404
      ) {
        adminReach.value = 'hidden';
      }
      return null;
    }
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

  // Pin / unpin (CLEAN-216), the signed-in account's own since CLEAN-231.
  // The record is patched at once, so the rail reorders on the click; the
  // pin routes carry it (the general update refuses the flag), and a refusal
  // rolls it back and rethrows for the caller to show. Nothing to upsert:
  // the routes answer 204, and the patched record already says what they did.
  async function setPinned(id: string, pinned: boolean) {
    const rollback = patch(id, { pinned });
    try {
      await getService().setPinned(id, pinned);
    } catch (err) {
      rollback();
      throw err;
    }
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

  /** The collapsed Logs bar reads this instead of the whole window: one line
   *  and two counts the api has already worked out (CLEAN-233). */
  function fetchLogSummary(id: string): Promise<IAgentLogSummary> {
    return getService().logSummary(id);
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
    forget,
    resetForAccount,
    capacity,
    adminReach,
    ensureAdminReach,
    fetchAll,
    fetchCapacity,
    fetchById,
    fetchAdmin,
    create,
    update,
    setPinned,
    restart,
    stop,
    start,
    remove,
    promoteAdmin,
    demoteAdmin,
    fetchLogs,
    fetchLogSummary,
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
