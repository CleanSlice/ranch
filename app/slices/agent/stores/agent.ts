import {
  AgentsService,
  type CreateAgentDto,
  type UpdateAgentDto,
} from '#api';

export interface IAgentData {
  id: string;
  name: string;
  status: string;
  templateId: string;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: { cpu: string; memory: string };
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface IEnvelope<T> {
  success?: boolean;
  data?: T;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as IEnvelope<T>)) {
    return ((body as IEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<IAgentData[]>([]);
  const publicAgents = ref<IAgentData[]>([]);
  const current = ref<IAgentData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await AgentsService.agentControllerFindAll();
      const list = unwrap<IAgentData[]>(res.data);
      agents.value = Array.isArray(list) ? list : [];
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
      const res = await AgentsService.agentControllerFindPublic();
      const list = unwrap<IAgentData[]>(res.data);
      publicAgents.value = Array.isArray(list) ? list : [];
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
      const res = await AgentsService.agentControllerFindById({ path: { id } });
      current.value = unwrap<IAgentData>(res.data);
    } catch (err) {
      error.value = (err as Error).message;
      current.value = null;
    } finally {
      loading.value = false;
    }
    return current.value;
  }

  async function create(body: CreateAgentDto) {
    const res = await AgentsService.agentControllerCreate({ body });
    const created = unwrap<IAgentData>(res.data);
    if (created) agents.value.push(created);
    return created;
  }

  async function update(id: string, body: UpdateAgentDto) {
    const res = await AgentsService.agentControllerUpdate({
      path: { id },
      body,
    });
    const updated = unwrap<IAgentData>(res.data);
    if (updated) {
      const idx = agents.value.findIndex((a) => a.id === id);
      if (idx >= 0) agents.value[idx] = updated;
    }
    return updated;
  }

  async function remove(id: string) {
    await AgentsService.agentControllerRemove({ path: { id } });
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  async function restart(id: string) {
    const res = await AgentsService.agentControllerRestart({ path: { id } });
    const updated = unwrap<IAgentData>(res.data);
    if (updated) {
      const idx = agents.value.findIndex((a) => a.id === id);
      if (idx >= 0) agents.value[idx] = updated;
    }
    return updated;
  }

  return {
    agents,
    publicAgents,
    current,
    loading,
    error,
    fetchAll,
    fetchPublic,
    fetchById,
    create,
    update,
    remove,
    restart,
  };
});
