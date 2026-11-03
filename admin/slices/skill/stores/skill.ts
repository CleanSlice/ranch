import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IImportFromGithubInput,
  IImportFromUrlInput,
  INameAvailability,
  ISkillData,
  ISkillInput,
  ISkillOrder,
  SkillService,
} from '#skill/domain';
import { moveVisible, orderDiff, toOrderItems } from '#skill/utils/reorder';

// Re-export the domain types so consumers importing them from
// `#skill/stores/skill` (Form, skillList/Create/Edit/Import Providers) keep
// working.
export type {
  ISkillData,
  ISkillDependentAgent,
  ISkillExistsConflict,
  ISkillFile,
  ISkillInput,
  ISkillOrder,
  ISkillOrderConflict,
  ISkillSearchHit,
  SkillGroup,
} from '#skill/domain';

const getService = createServiceGetter<SkillService>('$skillService');

/**
 * One record per skill (docs/state.md): the list, the summary, the strip,
 * the panel and the edit page all render `items` / `byId`; every call that
 * returns a skill upserts it here before returning. The library order is
 * state of its own — `saved` is what the server holds, `draft` is what the
 * admin has dragged and not yet saved (CLEAN-205).
 */
export const useSkillStore = defineStore('skill', () => {
  const items = ref<ISkillData[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const order = reactive<{
    version: string | null;
    saved: string[];
    draft: string[] | null;
    saving: boolean;
  }>({ version: null, saved: [], draft: null, saving: false });

  // ------------------------------------------------------------ lookups

  function byId(id: string): ISkillData | undefined {
    return items.value.find((x) => x.id === id);
  }

  function byName(name: string): ISkillData | undefined {
    return items.value.find((x) => x.name === name);
  }

  function upsert(skill: ISkillData): ISkillData {
    const idx = items.value.findIndex((x) => x.id === skill.id);
    if (idx >= 0) items.value.splice(idx, 1, skill);
    else items.value.push(skill);
    if (!order.saved.includes(skill.id)) order.saved.push(skill.id);
    return skill;
  }

  /**
   * Optimistic change with a rollback that restores a field only if it still
   * holds the optimistic value — a fresher server write in between survives.
   */
  function patch(id: string, partial: Partial<ISkillData>): () => void {
    const current = byId(id);
    if (!current) return () => {};
    const before: Partial<ISkillData> = {};
    for (const key of Object.keys(partial) as (keyof ISkillData)[]) {
      (before as unknown as Record<string, unknown>)[key] = current[key];
    }
    Object.assign(current, partial);
    return () => {
      const now = byId(id);
      if (!now) return;
      for (const key of Object.keys(partial) as (keyof ISkillData)[]) {
        if (now[key] === partial[key]) {
          (now as unknown as Record<string, unknown>)[key] = before[key];
        }
      }
    };
  }

  // ------------------------------------------------------------ reads

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await getService().findAll();
      const fresh = await getService().fetchOrder();
      applyOrder(fresh);
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function fetchById(id: string) {
    const skill = await getService().findById(id);
    return skill ? upsert(skill) : null;
  }

  // ------------------------------------------------------------ writes

  async function create(body: ISkillInput) {
    const created = await getService().create(body);
    return created ? upsert(created) : null;
  }

  async function update(id: string, body: Partial<ISkillInput>) {
    const updated = await getService().update(id, body);
    return updated ? upsert(updated) : null;
  }

  async function remove(id: string) {
    await getService().remove(id);
    items.value = items.value.filter((x) => x.id !== id);
    order.saved = order.saved.filter((x) => x !== id);
    if (order.draft) order.draft = order.draft.filter((x) => x !== id);
  }

  function search(q: string) {
    return getService().search(q);
  }

  async function importFromGithub(body: IImportFromGithubInput) {
    const record = await getService().importFromGithub(body);
    return record ? upsert(record) : null;
  }

  async function importFromUrl(body: IImportFromUrlInput) {
    const record = await getService().importFromUrl(body);
    return record ? upsert(record) : null;
  }

  function fetchDependentAgents(id: string) {
    return getService().findDependentAgents(id);
  }

  function isNameAvailable(name: string, excludeId?: string): Promise<INameAvailability> {
    return getService().isNameAvailable(name, excludeId);
  }

  // ------------------------------------------------------------ order

  function applyOrder(fresh: ISkillOrder) {
    order.version = fresh.version;
    const byPosition = [...fresh.items].sort((a, b) => a.sortOrder - b.sortOrder);
    const known = new Set(items.value.map((x) => x.id));
    order.saved = byPosition.map((i) => i.id).filter((id) => known.has(id));
    // Anything the list has that the order does not (a race with a create)
    // goes last, so no skill ever disappears from the page.
    for (const s of items.value) if (!order.saved.includes(s.id)) order.saved.push(s.id);
    for (const i of fresh.items) {
      const s = byId(i.id);
      if (s) s.sortOrder = i.sortOrder;
    }
    order.draft = null;
  }

  /** The order the list shows: the draft while one exists, else the saved one. */
  const currentOrder = computed(() => order.draft ?? order.saved);

  const diff = computed(() => orderDiff(order.saved, order.draft ?? order.saved));
  const movedCount = computed(() => diff.value.movedCount);

  /** Move the `from`-th visible row to the `to`-th slot among `visibleIds`. */
  function moveDraft(from: number, to: number, visibleIds: readonly string[]) {
    const base = order.draft ?? order.saved;
    const next = moveVisible(base, visibleIds, from, to);
    order.draft = orderDiff(order.saved, next).movedCount === 0 ? null : next;
  }

  function discardOrder() {
    order.draft = null;
  }

  /**
   * Save the draft as the shared order. On 409 the list is reloaded with the
   * other admin's order and the conflict is rethrown; on any other failure
   * the draft is dropped (the list snaps back) and the error is rethrown.
   */
  async function saveOrder(): Promise<void> {
    if (!order.draft || order.version === null) return;
    order.saving = true;
    const draft = order.draft;
    try {
      const fresh = await getService().saveOrder({
        version: order.version,
        items: toOrderItems(draft),
      });
      applyOrder(fresh);
    } catch (err) {
      order.draft = null;
      if ((err as { code?: string }).code === 'ORDER_CHANGED') await fetchAll();
      throw err;
    } finally {
      order.saving = false;
    }
  }

  return {
    items,
    loading,
    error,
    order,
    currentOrder,
    diff,
    movedCount,
    byId,
    byName,
    upsert,
    patch,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    search,
    importFromGithub,
    importFromUrl,
    fetchDependentAgents,
    isNameAvailable,
    moveDraft,
    discardOrder,
    saveOrder,
  };
});
