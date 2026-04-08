export const useAgentStore = defineStore('agent', () => {
  const agents = ref<unknown[]>([]);
  const current = ref<unknown | null>(null);

  async function fetchAll() {
    // Will use generated API SDK: AgentsService.findAll()
    return agents.value;
  }

  async function fetchById(id: string) {
    // Will use generated API SDK: AgentsService.findById({ id })
    return current.value;
  }

  async function create(data: Record<string, unknown>) {
    // Will use generated API SDK: AgentsService.create({ requestBody: data })
  }

  async function remove(id: string) {
    // Will use generated API SDK: AgentsService.remove({ id })
  }

  return { agents, current, fetchAll, fetchById, create, remove };
});
