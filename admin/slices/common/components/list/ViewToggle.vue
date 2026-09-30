<script setup lang="ts">
import { IconLayoutGrid, IconListDetails } from '@tabler/icons-vue';
import { useLocalStorage } from '@vueuse/core';
import {
  LIST_VIEWS,
  listViewStorageKey,
  readListView,
  type ListView,
} from '#common/utils/listView';

/**
 * Cards or table (CLEAN-132). Give it the list's name and the browser
 * remembers the choice for that list; the parent reads the view through
 * `v-model`. A stored value the list cannot draw falls back to `default`.
 */
const props = withDefaults(
  defineProps<{
    list: string;
    default?: ListView;
    views?: readonly ListView[];
  }>(),
  { default: 'cards', views: () => LIST_VIEWS },
);

const model = defineModel<ListView>({ required: true });

const stored = useLocalStorage<string>(listViewStorageKey(props.list), props.default);

watch(
  stored,
  (raw) => (model.value = readListView(raw, props.default, props.views)),
  { immediate: true },
);

function select(view: ListView) {
  model.value = view;
  stored.value = view;
}

const ICONS = { cards: IconLayoutGrid, table: IconListDetails } as const;
const TITLES = { cards: 'Cards', table: 'Table' } as const;
</script>

<template>
  <div class="flex gap-0.5 rounded-[9px] bg-muted p-[3px]" role="radiogroup" aria-label="View">
    <button
      v-for="v in views"
      :key="v"
      type="button"
      role="radio"
      :aria-checked="model === v"
      :title="TITLES[v]"
      class="grid h-7 w-[30px] place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="model === v ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
      @click="select(v)"
    >
      <component :is="ICONS[v]" class="size-3.5" />
      <span class="sr-only">{{ TITLES[v] }}</span>
    </button>
  </div>
</template>
