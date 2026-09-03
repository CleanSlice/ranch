<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';

/**
 * Entity picker for the graph.
 *
 * This replaces a plain `<Select>` fed the raw label list, which is what froze
 * the tab. `/graph/label/list` returns every entity in the whole index - tens
 * of thousands of them once a real corpus is indexed - and the select mounted a
 * DOM node for each one on open. Nothing here renders more than MAX_VISIBLE
 * rows no matter how long the list is; the rest is reached by typing.
 */
const ALL = '*';
const ALL_LABEL = '* (all entities)';
const MAX_VISIBLE = 50;

const props = defineProps<{
  modelValue: string;
  labels: string[];
  loading?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const query = ref('');

function displayFor(value: string): string {
  return value === ALL ? ALL_LABEL : value;
}

// Matching is done against a lowercased copy built once per label list rather
// than per keystroke: on 50k entries the difference is the whole point.
const lowerLabels = computed(() => props.labels.map((l) => l.toLowerCase()));

const filtered = computed<string[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.labels;
  const lower = lowerLabels.value;
  const found: string[] = [];
  for (let i = 0; i < lower.length; i += 1) {
    if (lower[i].includes(q)) found.push(props.labels[i]);
  }
  return found;
});

const visible = computed(() => filtered.value.slice(0, MAX_VISIBLE));
const hiddenCount = computed(() =>
  Math.max(0, filtered.value.length - MAX_VISIBLE),
);

// "* (all)" stays reachable whatever is typed: it is the default view and not
// an entity in the list.
const showAllOption = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q === '' || ALL_LABEL.includes(q) || q === ALL;
});

function pick(value: string): void {
  emit('update:modelValue', value);
  query.value = displayFor(value);
  open.value = false;
}

function focus(): void {
  open.value = true;
  // Clearing on focus makes the whole list browsable again; otherwise the
  // current selection would filter it down to itself.
  query.value = '';
}

function close(): void {
  if (!open.value) return;
  open.value = false;
  query.value = displayFor(props.modelValue);
}

watch(
  () => props.modelValue,
  (value) => {
    if (!open.value) query.value = displayFor(value);
  },
  { immediate: true },
);

onClickOutside(root, close);
</script>

<template>
  <div ref="root" class="relative">
    <Input
      :model-value="query"
      :placeholder="loading ? 'Loading entities…' : 'Search entities…'"
      :disabled="loading"
      class="w-64"
      role="combobox"
      :aria-expanded="open"
      @focus="focus"
      @keydown.esc="close"
      @update:model-value="(v: string | number) => { query = String(v); open = true; }"
    />

    <div
      v-if="open"
      class="absolute z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
    >
      <button
        v-if="showAllOption"
        type="button"
        class="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
        :class="modelValue === ALL ? 'bg-accent font-medium' : ''"
        @click="pick(ALL)"
      >
        {{ ALL_LABEL }}
      </button>

      <button
        v-for="label in visible"
        :key="label"
        type="button"
        class="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
        :class="modelValue === label ? 'bg-accent font-medium' : ''"
        :title="label"
        @click="pick(label)"
      >
        {{ label }}
      </button>

      <p
        v-if="hiddenCount"
        class="px-2 py-1.5 text-xs text-muted-foreground"
      >
        {{ hiddenCount }} more - keep typing to narrow it down
      </p>
      <p
        v-else-if="!visible.length && !showAllOption"
        class="px-2 py-1.5 text-xs text-muted-foreground"
      >
        Nothing matches "{{ query }}"
      </p>
    </div>
  </div>
</template>
