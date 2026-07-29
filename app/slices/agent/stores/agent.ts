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
  const agents = ref<IAgentData[]>([]);
  const publicAgents = ref<IAgentData[]>([]);
  const current = ref<IAgentData | null>(null);
  const capacity = ref<IClusterCapacityData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

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
      error.value = (err as Error).message;
      agents.value = [];
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

  async function fetchById(id: string) {
    loading.value = true;
    error.value = null;
    try {
      current.value = await getService().findById(id);
    } catch (err) {
      error.value = (err as Error).message;
      current.value = null;
    } finally {
      loading.value = false;
    }
    return current.value;
  }

  async function create(input: IAgentCreateInput) {
    const created = await getService().create(input);
    if (created) agents.value.push(created);
    // Fire-and-forget: the new agent reserves a slot server-side the moment
    // create returns, so a refetch already sees the counter drop.
    void fetchCapacity();
    return created;
  }

  async function update(id: string, input: IAgentUpdateInput) {
    const updated = await getService().update(id, input);
    if (updated) {
      const idx = agents.value.findIndex((a) => a.id === id);
      if (idx >= 0) agents.value[idx] = updated;
    }
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    agents.value = agents.value.filter((a) => a.id !== id);
    void fetchCapacity();
  }

  async function restart(id: string) {
    const updated = await getService().restart(id);
    if (updated) {
      const idx = agents.value.findIndex((a) => a.id === id);
      if (idx >= 0) agents.value[idx] = updated;
    }
    void fetchCapacity();
    return updated;
  }

  return {
    agents,
    publicAgents,
    current,
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
