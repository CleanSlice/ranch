export const useTemplateStore = defineStore('template', () => {
  const templates = ref<unknown[]>([]);
  const current = ref<unknown | null>(null);

  async function fetchAll() {
    // Will use generated API SDK: TemplatesService.findAll()
    return templates.value;
  }

  async function fetchById(id: string) {
    // Will use generated API SDK: TemplatesService.findById({ id })
    return current.value;
  }

  return { templates, current, fetchAll, fetchById };
});
