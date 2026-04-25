import { SkillsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export interface ISkillFile {
  path: string;
  content: string;
}

export interface ISkillData {
  id: string;
  name: string;
  title: string;
  description: string | null;
  body: string;
  files: ISkillFile[];
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ISkillInput {
  name: string;
  title: string;
  body: string;
  description?: string;
}

export interface ISkillSearchHit {
  source: string;
  repo: string;
  path: string;
  name: string;
  title: string;
  description: string | null;
  url: string;
  snippet: string | null;
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useSkillStore = defineStore('skill', () => {
  const items = ref<ISkillData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await SkillsService.skillControllerFindAll();
      items.value = unwrap<ISkillData[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function fetchById(id: string) {
    const res = await SkillsService.skillControllerFindById({ path: { id } });
    return unwrap<ISkillData>(res.data);
  }

  async function create(body: ISkillInput) {
    const res = await SkillsService.skillControllerCreate({ body });
    const created = unwrap<ISkillData>(res.data);
    if (created) items.value.push(created);
    return created;
  }

  async function update(id: string, body: Partial<ISkillInput>) {
    const res = await SkillsService.skillControllerUpdate({
      path: { id },
      body,
    });
    const updated = unwrap<ISkillData>(res.data);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await SkillsService.skillControllerRemove({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  async function search(q: string) {
    const res = await SkillsService.skillControllerSearch({ query: { q } });
    return unwrap<ISkillSearchHit[]>(res.data) ?? [];
  }

  async function importFromGithub(body: {
    repo: string;
    path: string;
    name?: string;
  }) {
    const res = await SkillsService.skillControllerImportFromGithub({ body });
    const created = unwrap<ISkillData>(res.data);
    if (created) items.value.push(created);
    return created;
  }

  async function importFromUrl(body: { url: string; name?: string }) {
    const res = await SkillsService.skillControllerImportFromUrl({ body });
    const created = unwrap<ISkillData>(res.data);
    if (created) items.value.push(created);
    return created;
  }

  return {
    items, loading, error,
    fetchAll, fetchById, create, update, remove,
    search, importFromGithub, importFromUrl,
  };
});
