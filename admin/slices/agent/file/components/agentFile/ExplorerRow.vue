<script setup lang="ts">
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFileCode,
  IconFileTypeJs,
  IconFolder,
  IconFolderOpen,
  IconJson,
  IconMarkdown,
  IconPhoto,
  IconTrash,
} from '@tabler/icons-vue';
import type { TreeNode } from '#agentFile/utils/fileTree';
import { formatBytes, formatModified } from '#agentFile/utils/format';

defineOptions({ name: 'AgentFileExplorerRow' });

const props = defineProps<{
  node: TreeNode;
  level: number;
  active: string | null;
  expanded: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  partial: ReadonlySet<string>;
  dirty: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  (e: 'open', path: string): void;
  (e: 'toggle', path: string): void;
  (e: 'select', path: string, on: boolean): void;
  (e: 'delete', path: string, type: 'file' | 'folder'): void;
}>();

const isOpen = computed(() => props.node.type === 'folder' && props.expanded.has(props.node.path));
const isChecked = computed(() => props.selected.has(props.node.path));
const isPartial = computed(() => props.node.type === 'folder' && props.partial.has(props.node.path));
const indent = computed(() => `${props.level * 14}px`);

function iconFor(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.md') return IconMarkdown;
  if (ext === '.json' || ext === '.jsonl') return IconJson;
  if (ext === '.js' || ext === '.ts' || ext === '.mjs') return IconFileTypeJs;
  if (ext === '.py' || ext === '.sh' || ext === '.yaml' || ext === '.yml') return IconFileCode;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return IconPhoto;
  return IconFile;
}

function onCheck(e: Event) {
  emit('select', props.node.path, (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <div
    class="group grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_4.5rem_1.5rem] items-center gap-1 rounded-md pr-1 text-xs hover:bg-accent/60"
    :class="[
      node.type === 'file' && active === node.path && 'bg-accent text-accent-foreground',
      isChecked && 'bg-primary/5',
    ]"
    :style="{ paddingLeft: `calc(0.25rem + ${indent})` }"
    :data-path="node.path"
  >
    <input
      type="checkbox"
      class="size-3.5 cursor-pointer accent-primary"
      :checked="isChecked"
      :indeterminate="isPartial"
      :aria-label="`Select ${node.path}`"
      @click.stop
      @change="onCheck"
    />

    <button
      v-if="node.type === 'folder'"
      type="button"
      class="flex min-w-0 items-center gap-1.5 py-1 text-left"
      @click="emit('toggle', node.path)"
    >
      <component :is="isOpen ? IconChevronDown : IconChevronRight" class="size-3.5 shrink-0 text-muted-foreground" />
      <component :is="isOpen ? IconFolderOpen : IconFolder" class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ node.name }}</span>
    </button>
    <button
      v-else
      type="button"
      class="flex min-w-0 items-center gap-1.5 py-1 text-left"
      :title="`${node.path} — modified ${node.updatedAt ? new Date(node.updatedAt).toLocaleString() : 'unknown'}`"
      @click="emit('open', node.path)"
    >
      <span class="size-3.5 shrink-0" />
      <component :is="iconFor(node.name)" class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ node.name }}</span>
      <span v-if="dirty.has(node.path)" class="size-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />
    </button>

    <span class="truncate text-right text-muted-foreground">
      {{ node.type === 'folder' ? node.count : formatBytes(node.size) }}
    </span>
    <span class="truncate text-right text-muted-foreground">
      {{ node.updatedAt ? formatModified(node.updatedAt) : '' }}
    </span>
    <button
      type="button"
      class="hidden justify-self-end rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
      :title="`Delete ${node.path}`"
      @click.stop="emit('delete', node.path, node.type)"
    >
      <IconTrash class="size-3.5" />
    </button>
  </div>

  <template v-if="node.type === 'folder' && isOpen">
    <AgentFileExplorerRow
      v-for="child in node.children"
      :key="child.path"
      :node="child"
      :level="level + 1"
      :active="active"
      :expanded="expanded"
      :selected="selected"
      :partial="partial"
      :dirty="dirty"
      @open="(p) => emit('open', p)"
      @toggle="(p) => emit('toggle', p)"
      @select="(p, on) => emit('select', p, on)"
      @delete="(p, t) => emit('delete', p, t)"
    />
  </template>
</template>
