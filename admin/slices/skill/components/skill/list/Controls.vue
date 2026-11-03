<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { ArrowDownUp } from 'lucide-vue-next';
import type { SkillLayout } from '#skill/composables/useSkillLayout';
import type { SkillSort } from '#skill/composables/useSkillListQuery';
import { SKILL_GROUP_KEYS, SKILL_GROUP_META, UNGROUPED_META } from '#skill/domain/skill.groups';
import type { GroupFilter } from '#skill/utils/filterSkills';
import type { groupCounts } from '#skill/utils/filterSkills';

/**
 * Search, group chips and sort for the Skills page (CLEAN-205). Search is
 * applied after a 150 ms pause so each keystroke does not rewrite the URL;
 * chips carry whole-library counts; on a phone the sort is a native select
 * and a Reorder button switches the drag mode on.
 */
const props = defineProps<{
  q: string;
  group: GroupFilter;
  sort: SkillSort;
  counts: ReturnType<typeof groupCounts>;
  layout: SkillLayout;
  reorderMode: boolean;
}>();

const emit = defineEmits<{
  'update:q': [value: string];
  'update:group': [value: GroupFilter];
  'update:sort': [value: SkillSort];
  'toggle-reorder': [];
}>();

const draft = ref(props.q);
watch(
  () => props.q,
  (v) => {
    if (v !== draft.value) draft.value = v;
  },
);
const pushQ = useDebounceFn((v: string) => emit('update:q', v), 150);
watch(draft, (v) => pushQ(v));

const chips = computed(() => {
  const list: { key: GroupFilter; label: string; count: number; classes?: string }[] = [
    { key: 'all', label: 'All', count: props.counts.all },
  ];
  for (const key of SKILL_GROUP_KEYS) {
    const count = props.counts.byGroup[key] ?? 0;
    if (count > 0 || props.group === key) {
      list.push({ key, label: SKILL_GROUP_META[key].label, count });
    }
  }
  if (props.counts.none > 0 || props.group === 'none') {
    list.push({ key: 'none', label: UNGROUPED_META.label, count: props.counts.none });
  }
  return list;
});

const SORT_OPTIONS = [
  { key: 'custom', label: 'Custom order' },
  { key: 'recent', label: 'Recently edited' },
] as const;

const sortModel = computed({
  get: () => props.sort,
  set: (v: SkillSort) => emit('update:sort', v),
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <ListToolbar>
      <ListSearch v-model="draft" placeholder="Search name, title or description" />
      <template #end>
        <template v-if="layout === 'phone'">
          <label class="sr-only" for="skill-sort">Sort</label>
          <select
            id="skill-sort"
            v-model="sortModel"
            class="h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option v-for="o in SORT_OPTIONS" :key="o.key" :value="o.key">{{ o.label }}</option>
          </select>
          <Button
            v-if="sort === 'custom'"
            :variant="reorderMode ? 'default' : 'outline'"
            size="sm"
            class="min-h-11"
            data-action="reorder-mode"
            :aria-pressed="reorderMode"
            @click="emit('toggle-reorder')"
          >
            <ArrowDownUp class="size-4" aria-hidden="true" />
            {{ reorderMode ? 'Done' : 'Reorder' }}
          </Button>
        </template>
        <ListSegments v-else v-model="sortModel" :options="SORT_OPTIONS" label="Sort" />
      </template>
    </ListToolbar>

    <div
      role="group"
      aria-label="Filter by group"
      class="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      <button
        v-for="chip in chips"
        :key="chip.key"
        type="button"
        :aria-pressed="group === chip.key"
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        :class="group === chip.key ? 'border-foreground bg-foreground text-background' : 'bg-background hover:bg-muted'"
        @click="emit('update:group', chip.key)"
      >
        {{ chip.label }}
        <span class="tabular-nums opacity-70">{{ chip.count }}</span>
      </button>
    </div>
  </div>
</template>
