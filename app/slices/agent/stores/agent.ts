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
  createdAt: string;
  updatedAt: string;
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<IAgentData[]>([]);
  const current = ref<IAgentData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await AgentsService.agentControllerFindAll();
      agents.value = (res.data as IAgentData[]) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
      agents.value = [];
    } finally {
      loading.value = false;
    }
    return agents.value;
  }

  async function fetchById(id: string) {
    loading.value = true;
    error.value = null;
    try {
      const res = await AgentsService.agentControllerFindById({ path: { id } });
      current.value = (res.data as IAgentData) ?? null;
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
    const created = res.data as IAgentData;
    if (created) agents.value.push(created);
    return created;
  }

  async function update(id: string, body: UpdateAgentDto) {
    const res = await AgentsService.agentControllerUpdate({
      path: { id },
      body,
    });
    const updated = res.data as IAgentData;
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
    const updated = res.data as IAgentData;
    if (updated) {
      const idx = agents.value.findIndex((a) => a.id === id);
      if (idx >= 0) agents.value[idx] = updated;
    }
    return updated;
  }

  return {
    agents,
    current,
    loading,
    error,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    restart,
  };
});
