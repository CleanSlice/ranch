<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconDownload, IconSearch, IconTrash, IconX } from '@tabler/icons-vue';
import type { IFileNode } from '#agentFile/domain';
import {
  ancestorsOf,
  buildTree,
  filterTree,
  fullySelectedFolders,
  partiallySelectedFolders,
  pathsUnder,
} from '#agentFile/utils/fileTree';
import AgentFileExplorerRow from './ExplorerRow.vue';

/**
 * The Files explorer (CLEAN-112, US5): filter, size/modified columns,
 * checkboxes with a bulk panel, dirty dots. Selection is owned by the store
 * (paths of files); folders are derived from it.
 */
const props = defineProps<{
  files: IFileNode[];
  active: string | null;
  selected: string[];
  dirty: string[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open', path: string): void;
  (e: 'update:selected', paths: string[]): void;
  (e: 'delete', path: string, type: 'file' | 'folder'): void;
  (e: 'bulk-download', paths: string[]): void;
  (e: 'bulk-delete', paths: string[]): void;
}>();

const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

const tree = computed(() => buildTree(props.files));
const visible = computed(() => filterTree(tree.value, query.value));
const selectedSet = computed(() => new Set(props.selected));
const dirtySet = computed(() => new Set(props.dirty));
const fullFolders = computed(() => fullySelectedFolders(tree.value, selectedSet.value));
const partialFolders = computed(() => partiallySelectedFolders(tree.value, selectedSet.value));
// Rows check when the file is selected or the folder is fully selected.
const checked = computed(() => new Set([...selectedSet.value, ...fullFolders.value]));

// Expansion: the operator's choice while unfiltered, everything matching while filtered.
const expandedByUser = ref<Set<string>>(new Set(['memory', 'skills', 'data', 'workspace']));
const expanded = computed(() => {
  if (!query.value.trim()) return expandedByUser.value;
  const paths: string[] = [];
  const walk = (nodes: readonly (typeof visible.value)[number][]) => {
    for (const n of nodes) {
      if (n.type === 'folder') walk(n.children);
      else paths.push(n.path);
    }
  };
  walk(visible.value);
  return ancestorsOf(paths);
});

function toggle(path: string) {
  if (query.value.trim()) return;
  const next = new Set(expandedByUser.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedByUser.value = next;
}

function select(path: string, on: boolean) {
  const covered = pathsUnder(props.files, path);
  const next = new Set(props.selected);
  for (const p of covered) {
    if (on) next.add(p);
    else next.delete(p);
  }
  emit('update:selected', [...next]);
}

function clear() {
  emit('update:selected', []);
}

// Ctrl/⌘+P focuses the filter, like an IDE's quick open.
function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    searchInput.value?.focus();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

defineExpose({ focusFilter: () => searchInput.value?.focus() });
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-xs">
    <label class="relative m-2 mb-1 block">
      <IconSearch class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        placeholder="Filter files…"
        class="h-8 w-full rounded-md border bg-background pl-7 pr-12 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <kbd class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border px-1 text-[10px] text-muted-foreground">⌘P</kbd>
    </label>

    <div
      v-if="selected.length"
      class="mx-2 mb-1 flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-2 py-1"
    >
      <span class="font-medium">{{ selected.length }} selected</span>
      <Button variant="outline" size="sm" class="h-6 px-2" :disabled="busy" @click="emit('bulk-download', selected)">
        <IconDownload class="size-3.5" />
        Download
      </Button>
      <Button variant="outline" size="sm" class="h-6 px-2 text-destructive" :disabled="busy" @click="emit('bulk-delete', selected)">
        <IconTrash class="size-3.5" />
        Delete
      </Button>
      <button type="button" class="ml-auto text-muted-foreground hover:text-foreground" @click="clear">
        Clear
        <IconX class="inline size-3" />
      </button>
    </div>

    <div class="grid grid-cols-[1.25rem_minmax(0,1fr)_3.75rem_3.5rem_1.25rem] gap-1 px-2 pb-1 pr-3 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span />
      <span>Name</span>
      <span class="text-right">Size</span>
      <span class="text-right">Modified</span>
      <span />
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-1 pb-2">
      <AgentFileExplorerRow
        v-for="node in visible"
        :key="node.path"
        :node="node"
        :level="0"
        :active="active"
        :expanded="expanded"
        :selected="checked"
        :partial="partialFolders"
        :dirty="dirtySet"
        @open="(p) => emit('open', p)"
        @toggle="toggle"
        @select="select"
        @delete="(p, t) => emit('delete', p, t)"
      />
      <div
        v-if="!visible.length"
        class="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground"
      >
        {{ files.length ? `Nothing matches “${query}”` : 'No files' }}
      </div>
    </div>
  </div>
</template>
