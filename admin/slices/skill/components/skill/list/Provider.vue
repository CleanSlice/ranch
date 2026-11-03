<script setup lang="ts">
import { useEventListener, useNow } from '@vueuse/core';
import { toast } from 'vue-sonner';
import type { ISkillData } from '#skill/domain';
import { useSkillLayout } from '#skill/composables/useSkillLayout';
import { useSkillListQuery } from '#skill/composables/useSkillListQuery';
import { useSortableList } from '#skill/composables/useSortableList';
import { byRecentEdit } from '#skill/utils/editTime';
import { filterSkills, groupCounts } from '#skill/utils/filterSkills';
import { badgeFor } from '#skill/utils/reorder';
import { librarySummary } from '#skill/utils/summary';
import type { SkillListState } from './States.vue';

/**
 * The Skills library (CLEAN-205). Every number and row here is a view of
 * `useSkillStore` — `useAsyncData` only carries the first load's pending
 * flag. Search, group, sort and the selected skill live in the URL.
 */
const skillStore = useSkillStore();
const confirmStore = useConfirmStore();

const { pending, refresh } = await useAsyncData('admin-skills', () => skillStore.fetchAll());

// One clock for every row's green dot and the summary's "last … ago":
// a minute is the finest grain the relative text shows.
const now = useNow({ interval: 60_000 });
const { layout } = useSkillLayout();
const query = useSkillListQuery();

// ------------------------------------------------------------ what to show

const ordered = computed<ISkillData[]>(() => {
  if (query.sort.value === 'recent') return byRecentEdit(skillStore.items);
  const byId = new Map(skillStore.items.map((s) => [s.id, s]));
  return skillStore.currentOrder
    .map((id) => byId.get(id))
    .filter((s): s is ISkillData => s !== undefined);
});
const visible = computed(() =>
  filterSkills(ordered.value, { q: query.q.value, group: query.group.value }),
);
const visibleIds = computed(() => visible.value.map((s) => s.id));
const counts = computed(() => groupCounts(skillStore.items));
const summary = computed(() => librarySummary(ordered.value, now.value));

const explicitSkill = computed(() =>
  query.selectedSlug.value ? (skillStore.byName(query.selectedSlug.value) ?? null) : null,
);
// The desktop column is never empty while there is something to show: it
// falls back to the first visible row. Tablet and phone open only on request.
const selectedSkill = computed(
  () => explicitSkill.value ?? (layout.value === 'desktop' ? (visible.value[0] ?? null) : null),
);

// An address naming a skill the library does not have: drop the parameter.
watch(
  [() => query.selectedSlug.value, () => skillStore.loading, () => skillStore.items.length],
  ([slug, loading, count]) => {
    if (slug && !loading && count > 0 && !skillStore.byName(slug)) query.replaceSelection(null);
  },
  { immediate: true },
);

const state = computed<SkillListState | null>(() => {
  if (skillStore.items.length === 0) {
    if (pending.value || skillStore.loading) return 'loading';
    if (skillStore.error) return 'error';
    return 'empty';
  }
  return visible.value.length === 0 ? 'no-match' : null;
});

// ------------------------------------------------------------ reordering

const reorderMode = ref(false);
const dragEnabled = computed(
  () => query.sort.value === 'custom' && (layout.value !== 'phone' || reorderMode.value),
);
const dragHint = computed(() =>
  query.sort.value === 'recent' ? 'Reordering is off while sorted by edit time' : null,
);
const listEl = ref<HTMLElement | null>(null);
const live = ref('');

const { dragging, indicatorTop } = useSortableList({ listEl, enabled: dragEnabled, onMove });

function onMove(from: number, to: number) {
  const id = visibleIds.value[from];
  if (!id) return;
  skillStore.moveDraft(from, to, visibleIds.value);
  const skill = skillStore.byId(id);
  const position = skillStore.currentOrder.indexOf(id) + 1;
  live.value = `${skill?.name ?? id} moved to position ${position} of ${skillStore.currentOrder.length}`;
}

/** Keyboard: ↑ / ↓ on a handle moves the row and keeps the focus on it. */
function moveBy(index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= visibleIds.value.length) return;
  const id = visibleIds.value[index];
  onMove(index, to);
  void nextTick(() => {
    const slug = id ? skillStore.byId(id)?.name : undefined;
    if (slug) listEl.value?.querySelector<HTMLElement>(`[data-skill-handle="${slug}"]`)?.focus();
  });
}

async function saveOrder() {
  try {
    await skillStore.saveOrder();
    toast.success('Order saved');
    reorderMode.value = false;
  } catch (err) {
    if ((err as { code?: string }).code === 'ORDER_CHANGED') {
      toast.warning('Someone else changed the order. The list was reloaded.');
    } else {
      toast.error('Could not save the order');
    }
  }
}

const discardAsk = {
  title: 'Discard unsaved order?',
  description: 'The rows you moved are not saved yet. They will go back to the saved order.',
  confirmLabel: 'Discard',
  cancelLabel: 'Stay',
  variant: 'destructive' as const,
};

async function toggleReorder() {
  if (reorderMode.value && skillStore.order.draft) {
    if (!(await confirmStore.ask(discardAsk))) return;
    skillStore.discardOrder();
  }
  reorderMode.value = !reorderMode.value;
}

onBeforeRouteLeave(async () => {
  if (!skillStore.order.draft) return true;
  return confirmStore.ask(discardAsk);
});

useEventListener(
  () => (typeof window === 'undefined' ? null : window),
  'beforeunload',
  (e: BeforeUnloadEvent) => {
    if (!skillStore.order.draft) return;
    e.preventDefault();
    e.returnValue = '';
  },
);

// ------------------------------------------------------------ deleting

const deleting = ref(false);
// A phone's ⋯ → Delete opens the sheet with the confirmation already up.
const confirmDeleteFor = ref<string | null>(null);

function requestDelete(skill: ISkillData) {
  confirmDeleteFor.value = skill.id;
  query.select(skill.name);
}

async function onDelete(skill: ISkillData) {
  const list = visible.value;
  const i = list.findIndex((s) => s.id === skill.id);
  const neighbour = list[i + 1] ?? list[i - 1] ?? null;
  deleting.value = true;
  try {
    await skillStore.remove(skill.id);
    toast.success(`Skill ${skill.name} deleted`);
    if (query.selectedSlug.value) query.replaceSelection(neighbour?.name ?? null);
  } catch (err) {
    toast.error((err as Error).message || 'Could not delete the skill');
  } finally {
    deleting.value = false;
    confirmDeleteFor.value = null;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 overflow-x-hidden">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold">Skills</h1>
        <p class="text-sm text-muted-foreground">
          Markdown skills that get mounted into agents under
          <code>.agent/skills/&lt;name&gt;/</code>. Attach them to templates to
          ship with every agent of that template.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" as-child>
          <NuxtLink to="/skills/import">Import from GitHub</NuxtLink>
        </Button>
        <Button as-child>
          <NuxtLink to="/skills/create">New skill</NuxtLink>
        </Button>
      </div>
    </div>

    <SkillListStates
      v-if="state === 'loading' || state === 'error' || state === 'empty'"
      :state="state"
      :message="skillStore.error"
      @retry="refresh()"
    />

    <div v-else class="flex items-start gap-6">
      <main class="flex min-w-0 flex-1 flex-col gap-5 xl:min-w-[560px]">
        <section class="flex flex-col gap-4 rounded-lg border bg-card p-4" aria-label="Library overview">
          <SkillListSummary :summary="summary" />
          <SkillListSizeStrip
            :skills="ordered"
            :selected-id="selectedSkill?.id ?? null"
            @select="query.select"
          />
        </section>

        <SkillListControls
          :q="query.q.value"
          :group="query.group.value"
          :sort="query.sort.value"
          :counts="counts"
          :layout="layout"
          :reorder-mode="reorderMode"
          @update:q="query.setQ"
          @update:group="query.setGroup"
          @update:sort="query.setSort"
          @toggle-reorder="toggleReorder"
        />

        <SkillListOrderBar
          v-if="skillStore.order.draft"
          :moved-count="skillStore.movedCount"
          :saving="skillStore.order.saving"
          :pinned="layout === 'phone'"
          @discard="skillStore.discardOrder()"
          @save="saveOrder"
        />

        <SkillListStates v-if="state === 'no-match'" state="no-match" @clear="query.clearFilters()" />

        <div
          v-else
          class="relative rounded-lg border bg-card"
          :class="[dragging !== null && 'select-none', layout === 'phone' && skillStore.order.draft && 'mb-24']"
        >
          <ul ref="listEl" data-skill-list class="relative" :aria-busy="skillStore.order.saving || undefined">
            <SkillListRow
              v-for="(skill, i) in visible"
              :key="skill.id"
              :skill="skill"
              :selected="selectedSkill?.id === skill.id"
              :layout="layout"
              :position="i + 1"
              :total="visible.length"
              :drag-enabled="dragEnabled"
              :drag-hint="dragHint"
              :badge="badgeFor(skillStore.diff.byId[skill.id])"
              :dragging="dragging === i"
              :now="now"
              @select="query.select(skill.name)"
              @move="moveBy(i, $event)"
              @delete="requestDelete(skill)"
            />
          </ul>
          <div
            v-if="dragging !== null"
            data-skill-drop-indicator
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 h-[3px] -translate-y-1/2 rounded bg-primary"
            :style="{ top: `${indicatorTop}px` }"
          />
        </div>

        <p data-skill-live aria-live="polite" class="sr-only">{{ live }}</p>
      </main>

      <SkillPanelHost
        :skill="selectedSkill"
        :layout="layout"
        :total-tokens="summary.totalTokens"
        :deleting="deleting"
        :confirm-delete-for="confirmDeleteFor"
        @close="query.clearSelection()"
        @delete="onDelete"
      />
    </div>
  </div>
</template>
