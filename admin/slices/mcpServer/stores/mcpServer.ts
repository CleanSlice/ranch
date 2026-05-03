import { McpServersService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type McpServerTransportTypes = 'streamableHttp' | 'sse';
export type McpServerAuthTypes = 'none' | 'bearer' | 'header';

export interface IMcpServerData {
  id: string;
  name: string;
  description: string | null;
  url: string;
  transport: McpServerTransportTypes;
  authType: McpServerAuthTypes;
  authValue: string | null;
  enabled: boolean;
  builtIn: boolean;
  templateIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ICreateMcpServerData {
  name: string;
  description?: string | null;
  url: string;
  transport?: McpServerTransportTypes;
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  enabled?: boolean;
}

export interface IUpdateMcpServerData {
  name?: string;
  description?: string | null;
  url?: string;
  transport?: McpServerTransportTypes;
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  enabled?: boolean;
}

export const useMcpServerStore = defineStore('mcpServer', () => {
  const items = ref<IMcpServerData[]>([]);

  async function fetchAll() {
    const res = await McpServersService.mcpServerControllerFindAll();
    const env = res.data as ApiEnvelope<IMcpServerData[]> | undefined;
    items.value = env?.data ?? [];
    return items.value;
  }

  async function fetchById(id: string) {
    const res = await McpServersService.mcpServerControllerFindById({
      path: { id },
    });
    const env = res.data as ApiEnvelope<IMcpServerData | null> | undefined;
    return env?.data ?? null;
  }

  async function create(data: ICreateMcpServerData) {
    const res = await McpServersService.mcpServerControllerCreate({ body: data });
    const env = res.data as ApiEnvelope<IMcpServerData>;
    items.value = [env.data, ...items.value];
    return env.data;
  }

  async function update(id: string, data: IUpdateMcpServerData) {
    const res = await McpServersService.mcpServerControllerUpdate({
      path: { id },
      body: data,
    });
    const env = res.data as ApiEnvelope<IMcpServerData>;
    items.value = items.value.map((m) => (m.id === id ? env.data : m));
    return env.data;
  }

  async function remove(id: string) {
    await McpServersService.mcpServerControllerRemove({ path: { id } });
    items.value = items.value.filter((m) => m.id !== id);
  }

  return { items, fetchAll, fetchById, create, update, remove };
});
