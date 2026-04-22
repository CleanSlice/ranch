import { AgentsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

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

export interface IAgentData {
  id: string;
  name: string;
  templateId: string;
  llmCredentialId: string | null;
  status: AgentStatusTypes;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateAgentData {
  name: string;
  templateId: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
}

export interface IUpdateAgentData {
  name?: string;
  templateId?: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
}

export const useAgentStore = defineStore('agent', () => {
  const agents = ref<IAgentData[]>([]);

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
    const env = res.data as ApiEnvelope<IAgentData>;
    agents.value = agents.value.map((a) => (a.id === id ? env.data : a));
    return env.data;
  }

  async function restart(id: string) {
    const res = await AgentsService.agentControllerRestart({ path: { id } });
    const env = res.data as ApiEnvelope<IAgentData>;
    agents.value = agents.value.map((a) => (a.id === id ? env.data : a));
    return env.data;
  }

  async function remove(id: string) {
    await AgentsService.agentControllerRemove({ path: { id } });
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  return { agents, fetchAll, fetchById, create, update, restart, remove };
});
