export const useTemplateStore = defineStore('template', () => {
  const templates = ref<unknown[]>([]);

  async function fetchAll() {
    return templates.value;
  }

  async function fetchById(id: string) {
    return templates.value.find((t: any) => t.id === id) || null;
  }

  async function create(data: Record<string, unknown>) {
    // TemplatesService.create({ requestBody: data })
  }

  async function update(id: string, data: Record<string, unknown>) {
    // TemplatesService.update({ id, requestBody: data })
  }

  async function remove(id: string) {
    // TemplatesService.remove({ id })
  }

  return { templates, fetchAll, fetchById, create, update, remove };
});
