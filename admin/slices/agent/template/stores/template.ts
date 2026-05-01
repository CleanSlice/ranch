import { TemplatesService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface ITemplateResources {
  cpu: string;
  memory: string;
}

export interface ITemplateData {
  id: string;
  name: string;
  description: string;
  image: string;
  defaultConfig: Record<string, unknown>;
  defaultResources: ITemplateResources;
  defaultKnowledgeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ICreateTemplateData {
  name: string;
  description: string;
  image: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: ITemplateResources;
  defaultKnowledgeIds?: string[];
}

export interface IUpdateTemplateData {
  name?: string;
  description?: string;
  image?: string;
  defaultConfig?: Record<string, unknown>;
  defaultResources?: ITemplateResources;
  defaultKnowledgeIds?: string[];
}

export const useTemplateStore = defineStore('template', () => {
  const templates = ref<ITemplateData[]>([]);

  async function fetchAll() {
    const res = await TemplatesService.templateControllerFindAll();
    const env = res.data as ApiEnvelope<ITemplateData[]> | undefined;
    templates.value = env?.data ?? [];
    return templates.value;
  }

  async function fetchById(id: string) {
    const res = await TemplatesService.templateControllerFindById({ path: { id } });
    const env = res.data as ApiEnvelope<ITemplateData | null> | undefined;
    return env?.data ?? null;
  }

  async function create(data: ICreateTemplateData) {
    const res = await TemplatesService.templateControllerCreate({ body: data });
    const env = res.data as ApiEnvelope<ITemplateData>;
    templates.value = [env.data, ...templates.value];
    return env.data;
  }

  async function update(id: string, data: IUpdateTemplateData) {
    const res = await TemplatesService.templateControllerUpdate({
      path: { id },
      body: data,
    });
    const env = res.data as ApiEnvelope<ITemplateData>;
    templates.value = templates.value.map((t) => (t.id === id ? env.data : t));
    return env.data;
  }

  async function remove(id: string) {
    await TemplatesService.templateControllerRemove({ path: { id } });
    templates.value = templates.value.filter((t) => t.id !== id);
  }

  return { templates, fetchAll, fetchById, create, update, remove };
});
