import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IImportFromGithubInput,
  IImportFromUrlInput,
  ISkillData,
  ISkillInput,
  SkillService,
} from '#skill/domain';

// Re-export the domain types so consumers importing them from
// `#skill/stores/skill` (Form, skillList/Create/Edit/Import Providers) keep
// working.
export type {
  ISkillData,
  ISkillDependentAgent,
  ISkillExistsConflict,
  ISkillFile,
  ISkillInput,
  ISkillSearchHit,
} from '#skill/domain';

const getService = createServiceGetter<SkillService>('$skillService');

export const useSkillStore = defineStore('skill', () => {
  const items = ref<ISkillData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await getService().findAll();
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  function fetchById(id: string) {
    return getService().findById(id);
  }

  async function create(body: ISkillInput) {
    const created = await getService().create(body);
    if (created) items.value.push(created);
    return created;
  }

  async function update(id: string, body: Partial<ISkillInput>) {
    const updated = await getService().update(id, body);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    items.value = items.value.filter((x) => x.id !== id);
  }

  function search(q: string) {
    return getService().search(q);
  }

  function placeImported(record: ISkillData | null) {
    if (!record) return null;
    const idx = items.value.findIndex((x) => x.id === record.id);
    if (idx >= 0) items.value.splice(idx, 1, record);
    else items.value.push(record);
    return record;
  }

  async function importFromGithub(body: IImportFromGithubInput) {
    return placeImported(await getService().importFromGithub(body));
  }

  async function importFromUrl(body: IImportFromUrlInput) {
    return placeImported(await getService().importFromUrl(body));
  }

  function fetchDependentAgents(id: string) {
    return getService().findDependentAgents(id);
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    search,
    importFromGithub,
    importFromUrl,
    fetchDependentAgents,
  };
});
