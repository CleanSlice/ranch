export const useAgentStore = defineStore('agent', () => {
  const agents = ref<unknown[]>([]);

  async function fetchAll() {
    return agents.value;
  }

  async function fetchById(id: string) {
    return agents.value.find((a: any) => a.id === id) || null;
  }

  async function restart(id: string) {
    // AgentsService.restart({ id })
  }

  async function remove(id: string) {
    // AgentsService.remove({ id })
  }

  return { agents, fetchAll, fetchById, restart, remove };
});
