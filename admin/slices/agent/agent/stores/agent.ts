import { AgentsService, LogsService } from '#api/data';

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

  async function remove(id: string) {
    await AgentsService.agentControllerRemove({ path: { id } });
    agents.value = agents.value.filter((a) => a.id !== id);
  }

  async function fetchLogs(id: string): Promise<string> {
    const res = await LogsService.logControllerGetLogs({ path: { agentId: id } });
    const env = res.data as ApiEnvelope<{ logs: string }> | undefined;
    return env?.data?.logs ?? '';
  }

  return { agents, fetchAll, fetchById, create, update, restart, remove, fetchLogs };
});
