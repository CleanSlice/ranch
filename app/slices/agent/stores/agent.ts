import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentService,
  IAgentCreateInput,
  IAgentData,
  IAgentLinkData,
  IAgentToolState,
  IAgentUpdateInput,
  IClusterCapacityData,
} from '#agent/domain';

// Re-export domain types so consumers importing them from `#agent/stores/agent`
// (landingHero AgentCard/Provider) keep working.
export type {
  IAgentCreateInput,
  IAgentData,
  IAgentUpdateInput,
} from '#agent/domain';

const getService = createServiceGetter<AgentService>('$agentService');

export const useAgentStore = defineStore('agent', () => {
  // Single source of truth (docs/state.md): an agent lives here once. Every
  // fetch upserts into this collection and components render `byId(id)` —
  // never the value a fetch handed back — so the rail row and the open chat's
  // header are the same object and cannot disagree.
  const agents = ref<IAgentData[]>([]);
  // A separate projection on purpose: the landing page's public cards are a
  // different audience and a different query, not a view of `agents`.
  const publicAgents = ref<IAgentData[]>([]);
  const capacity = ref<IClusterCapacityData | null>(null);
  // Agent-to-agent connections for the orbit map. Not part of an agent record:
  // a link belongs to a pair, so it lives beside the agents, once.
  const links = ref<IAgentLinkData[]>([]);
  // Whether an agent has request limits, by agent id (CLEAN-224). Beside the
  // records, not in them: it comes from its own endpoint, and `upsert` replaces
  // a record whole — a status poll would wipe a field it does not carry. An
  // id that is absent has not been answered yet; the sheet then says nothing.
  const limitsEnabled = ref<Record<string, boolean>>({});
  // Which tool servers an agent is missing, by agent id (CLEAN-245). Beside
  // the records for the same reason as the limits: its own endpoint, asked
  // only for a manager and only while the record's `toolState` says there is
  // something to name.
  const toolStates = ref<Record<string, IAgentToolState>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);
  // Bumped by `resetForAccount`: the answer to a request that was open when
  // the account changed is about the previous account and is dropped.
  let accountGeneration = 0;

  // Whoever was signed in is not any more (CLEAN-231): everything read for
  // them goes, so the next account's first screen is its own list. The ONE
  // way this store is emptied for an account change (docs/state.md).
  // `publicAgents` stays: the landing page's cards are for everybody.
  function resetForAccount() {
    accountGeneration += 1;
    agents.value = [];
    capacity.value = null;
    links.value = [];
    limitsEnabled.value = {};
    toolStates.value = {};
    loading.value = false;
    error.value = null;
  }

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
  // value: if a fetch wrote something fresher in between, undoing the guess
  // must not undo the truth.
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

  // Silent degradation on purpose: 403 (non-admin), K8s unreachable, or
  // network failure all mean "no number to show" — never an error banner.
  async function fetchCapacity() {
    const generation = accountGeneration;
    try {
      const next = await getService().getCapacity();
      if (generation === accountGeneration) capacity.value = next;
    } catch {
      if (generation === accountGeneration) capacity.value = null;
    }
    return capacity.value;
  }

  // Same silent degradation as capacity: a regular user is refused (403) and
  // simply sees a map without connections. A failed refresh keeps the links
  // already drawn rather than blinking them off.
  async function fetchLinks() {
    const generation = accountGeneration;
    try {
      const next = await getService().getLinks();
      if (generation === accountGeneration) links.value = next;
    } catch {
      // Keep what we have.
    }
    return links.value;
  }

  // Undefined until the API has answered for this agent.
  function limitsEnabledFor(id: string): boolean | undefined {
    return limitsEnabled.value[id];
  }

  // Same silent degradation as capacity and links: no answer leaves what we
  // have — a failed refresh must not flip "limits on" to nothing on screen.
  async function fetchLimitsEnabled(id: string) {
    const generation = accountGeneration;
    try {
      const enabled = await getService().getLimitsEnabled(id);
      if (enabled !== null && generation === accountGeneration) {
        limitsEnabled.value[id] = enabled;
      }
    } catch {
      // Keep what we have.
    }
    return limitsEnabled.value[id];
  }

  // Undefined until a manager's request has been answered.
  function toolStateFor(id: string): IAgentToolState | undefined {
    return toolStates.value[id];
  }

  // No answer leaves what we have: a failed refresh must not swap a named
  // server for the generic line on screen.
  async function fetchToolState(id: string) {
    const generation = accountGeneration;
    try {
      const state = await getService().getToolState(id);
      if (state && generation === accountGeneration) toolStates.value[id] = state;
    } catch {
      // Keep what we have.
    }
    return toolStates.value[id];
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    const generation = accountGeneration;
    try {
      const next = await getService().findAll();
      if (generation === accountGeneration) agents.value = next;
    } catch (err) {
      // Keep the rows we have: this runs on a 30s poll, and the open chat
      // renders from the same collection — one failed poll must not unmount it.
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return agents.value;
  }

  async function fetchPublic() {
    loading.value = true;
    error.value = null;
    try {
      publicAgents.value = await getService().findPublic();
    } catch (err) {
      error.value = (err as Error).message;
      publicAgents.value = [];
    } finally {
      loading.value = false;
    }
    return publicAgents.value;
  }

  // Null on failure, and the record (if any) is left alone — this is also the
  // 3s status poll, and a failed poll is not "the agent is gone".
  async function fetchById(id: string) {
    loading.value = true;
    error.value = null;
    const generation = accountGeneration;
    try {
      const agent = await getService().findById(id);
      if (generation !== accountGeneration) return null;
      return agent ? upsert(agent) : null;
    } catch (err) {
      error.value = (err as Error).message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: IAgentCreateInput) {
    const created = await getService().create(input);
    if (created) upsert(created);
    // Fire-and-forget: the new agent reserves a slot server-side the moment
    // create returns, so a refetch already sees the counter drop.
    void fetchCapacity();
    return created;
  }

  async function update(id: string, input: IAgentUpdateInput) {
    const updated = await getService().update(id, input);
    if (updated) upsert(updated);
    return updated;
  }

  // Pin / unpin (CLEAN-216), the signed-in account's own since CLEAN-231.
  // The record is patched at once, so every list reorders on the click; the
  // pin routes carry it (the general update refuses the flag), and a refusal
  // rolls it back and rethrows for the caller to show. Nothing to upsert:
  // the routes answer 204, and the patched record already says what they did.
  async function setPinned(id: string, pinned: boolean) {
    const rollback = patch(id, { pinned });
    try {
      await getService().setPinned(id, pinned);
      return byId(id) ?? null;
    } catch (err) {
      rollback();
      throw err;
    }
  }

  async function remove(id: string) {
    await getService().remove(id);
    agents.value = agents.value.filter((a) => a.id !== id);
    void fetchCapacity();
  }

  // The API says this account does not reach the agent any more (the hub's
  // `AGENT_NOT_FOUND` on an open chat, CLEAN-231): the record goes, so no
  // list offers it. Not a delete: nothing is asked of the server.
  function forget(id: string): void {
    if (!byId(id)) return;
    agents.value = agents.value.filter((a) => a.id !== id);
    links.value = links.value.filter(
      (l) => l.agentId !== id && l.peerAgentId !== id,
    );
    delete limitsEnabled.value[id];
  }

  // Optimistic: flip to 'deploying' so every screen showing this agent reacts
  // before the API resolves (cancel + submit takes seconds). Revert on error.
  async function restart(id: string) {
    const rollback = patch(id, { status: 'deploying' });
    try {
      const updated = await getService().restart(id);
      if (updated) upsert(updated);
      void fetchCapacity();
      return updated;
    } catch (err) {
      rollback();
      throw err;
    }
  }

  // Same optimistic shape as restart: the rail, the orbit and the open chat
  // all read the one record, so they flip together and roll back together.
  async function stop(id: string) {
    const rollback = patch(id, { status: 'stopped' });
    try {
      const updated = await getService().stop(id);
      if (updated) upsert(updated);
      void fetchCapacity();
      return updated;
    } catch (err) {
      rollback();
      throw err;
    }
  }

  async function start(id: string) {
    const rollback = patch(id, { status: 'deploying' });
    try {
      const updated = await getService().start(id);
      if (updated) upsert(updated);
      void fetchCapacity();
      return updated;
    } catch (err) {
      rollback();
      throw err;
    }
  }

  return {
    agents,
    publicAgents,
    byId,
    upsert,
    patch,
    forget,
    resetForAccount,
    capacity,
    links,
    loading,
    error,
    fetchAll,
    fetchPublic,
    fetchById,
    fetchCapacity,
    fetchLinks,
    limitsEnabled,
    limitsEnabledFor,
    fetchLimitsEnabled,
    toolStates,
    toolStateFor,
    fetchToolState,
    create,
    update,
    setPinned,
    remove,
    restart,
    stop,
    start,
  };
});
