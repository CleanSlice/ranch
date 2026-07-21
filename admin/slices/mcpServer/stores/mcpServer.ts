import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
  McpServerService,
} from '#mcpServer/domain';

// Re-export the domain types so consumers importing them from
// `#mcpServer/stores/mcpServer` (mcpServerForm/List Providers, pages,
// templateMcps) keep working.
export type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
  McpServerAuthTypes,
  McpServerTransportTypes,
} from '#mcpServer/domain';

const getService = createServiceGetter<McpServerService>('$mcpServerService');

export const useMcpServerStore = defineStore('mcpServer', () => {
  const items = ref<IMcpServerData[]>([]);

  async function fetchAll() {
    items.value = await getService().findAll();
    return items.value;
  }

  function fetchById(id: string) {
    return getService().findById(id);
  }

  async function create(data: ICreateMcpServerData) {
    const created = await getService().create(data);
    items.value = [created, ...items.value];
    return created;
  }

  async function update(id: string, data: IUpdateMcpServerData) {
    const updated = await getService().update(id, data);
    items.value = items.value.map((m) => (m.id === id ? updated : m));
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    items.value = items.value.filter((m) => m.id !== id);
  }

  return { items, fetchAll, fetchById, create, update, remove };
});
