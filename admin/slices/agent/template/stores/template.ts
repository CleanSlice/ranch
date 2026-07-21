import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreateTemplateData,
  ITemplateData,
  IUpdateTemplateData,
  TemplateService,
} from '#template/domain';

// Re-export the domain types so consumers importing them from
// `#template/stores/template` (template Form, templateList/Create/Edit
// Providers, agent Form, rancher store, …) keep working.
export type {
  ICreateTemplateData,
  IRestartAgentsResult,
  ITemplateData,
  ITemplateResources,
  IUpdateTemplateData,
} from '#template/domain';

const getService = createServiceGetter<TemplateService>('$templateService');

export const useTemplateStore = defineStore('template', () => {
  const templates = ref<ITemplateData[]>([]);

  async function fetchAll() {
    templates.value = await getService().findAll();
    return templates.value;
  }

  function fetchById(id: string) {
    return getService().findById(id);
  }

  async function create(data: ICreateTemplateData) {
    const created = await getService().create(data);
    templates.value = [created, ...templates.value];
    return created;
  }

  async function update(id: string, data: IUpdateTemplateData) {
    const updated = await getService().update(id, data);
    templates.value = templates.value.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    templates.value = templates.value.filter((t) => t.id !== id);
  }

  async function setSkills(id: string, skillIds: string[]) {
    const updated = await getService().setSkills(id, skillIds);
    templates.value = templates.value.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  async function setMcps(id: string, mcpServerIds: string[]) {
    const updated = await getService().setMcps(id, mcpServerIds);
    templates.value = templates.value.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  // Restart every agent using this template. The endpoint lives on the agent
  // controller (to avoid TemplateModule ↔ AgentModule circular deps) — the
  // service wraps it so UI components don't need to import AgentsService.
  function restartAgents(templateId: string) {
    return getService().restartAgents(templateId);
  }

  return {
    templates,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    setSkills,
    setMcps,
    restartAgents,
  };
});
