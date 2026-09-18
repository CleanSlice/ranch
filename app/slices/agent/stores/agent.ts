import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentService,
  IAgentCreateInput,
  IAgentData,
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
  const loading = ref(false);
  const error = ref<string | null>(null);

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
        if (current[key] === partial[key]) restored[key] = previous[key];
      }
      agents.value = agents.value.map((a) =>
        a.id === id ? { ...a, ...(restored as Partial<IAgentData>) } : a,
      );
    };
  }

  // Silent degradation on purpose: 403 (non-admin), K8s unreachable, or
  // network failure all mean "no number to show" — never an error banner.
  async function fetchCapacity() {
    try {
      capacity.value = await getService().getCapacity();
    } catch {
      capacity.value = null;
    }
    return capacity.value;
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      agents.value = await getService().findAll();
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
    try {
      const agent = await getService().findById(id);
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

  async function remove(id: string) {
    await getService().remove(id);
    agents.value = agents.value.filter((a) => a.id !== id);
    void fetchCapacity();
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

  return {
    agents,
    publicAgents,
    byId,
    upsert,
    patch,
    capacity,
    loading,
    error,
    fetchAll,
    fetchPublic,
    fetchById,
    fetchCapacity,
    create,
    update,
    remove,
    restart,
  };
});
