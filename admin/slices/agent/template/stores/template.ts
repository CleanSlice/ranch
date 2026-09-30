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
  // A template lives here once (docs/state.md): the list fetch replaces the
  // collection, every single-entity call upserts into it, and the list and
  // the detail page read the same record by id.
  const templates = ref<ITemplateData[]>([]);

  function byId(id: string): ITemplateData | undefined {
    return templates.value.find((t) => t.id === id);
  }

  function upsert(template: ITemplateData): ITemplateData {
    const i = templates.value.findIndex((t) => t.id === template.id);
    if (i === -1) templates.value = [template, ...templates.value];
    else templates.value.splice(i, 1, template);
    return template;
  }

  async function fetchAll() {
    templates.value = await getService().findAll();
    return templates.value;
  }

  async function fetchById(id: string) {
    const found = await getService().findById(id);
    return found ? upsert(found) : null;
  }

  async function create(data: ICreateTemplateData) {
    return upsert(await getService().create(data));
  }

  async function update(id: string, data: IUpdateTemplateData) {
    return upsert(await getService().update(id, data));
  }

  async function remove(id: string) {
    await getService().remove(id);
    templates.value = templates.value.filter((t) => t.id !== id);
  }

  async function setSkills(id: string, skillIds: string[]) {
    return upsert(await getService().setSkills(id, skillIds));
  }

  async function setMcps(id: string, mcpServerIds: string[]) {
    return upsert(await getService().setMcps(id, mcpServerIds));
  }

  // Restart every agent using this template. The endpoint lives on the agent
  // controller (to avoid TemplateModule ↔ AgentModule circular deps) — the
  // service wraps it so UI components don't need to import AgentsService.
  function restartAgents(templateId: string) {
    return getService().restartAgents(templateId);
  }

  return {
    templates,
    byId,
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
