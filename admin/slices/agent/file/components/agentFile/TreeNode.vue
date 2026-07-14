<script setup lang="ts">
import { IconFile, IconFolder, IconFolderOpen, IconTrash } from '@tabler/icons-vue';

defineOptions({ name: 'TreeNode' });

interface FolderNodeT {
  type: 'folder';
  name: string;
  path: string;
  children: NodeT[];
}

interface FileNodeT {
  type: 'file';
  name: string;
  path: string;
  size: number;
}

type NodeT = FolderNodeT | FileNodeT;

const props = defineProps<{
  node: NodeT;
  selected: string | null;
  level: number;
  expandedMap: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: 'select', path: string): void;
  (e: 'toggle', path: string): void;
  (e: 'delete', path: string, type: 'file' | 'folder'): void;
}>();

const isExpanded = computed(() =>
  props.node.type === 'folder' ? props.expandedMap[props.node.path] ?? false : false,
);

const indent = computed(() => `${props.level * 12}px`);

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <template v-if="node.type === 'folder'">
    <div class="group flex w-full items-center rounded-md hover:bg-accent">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
        :style="{ paddingLeft: `calc(0.5rem + ${indent})` }"
        @click="emit('toggle', node.path)"
      >
        <IconFolderOpen v-if="isExpanded" class="size-4 shrink-0 text-muted-foreground" />
        <IconFolder v-else class="size-4 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ node.name }}</span>
      </button>
      <button
        type="button"
        class="mr-1 hidden shrink-0 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
        :title="`Delete folder ${node.path}`"
        @click.stop="emit('delete', node.path, 'folder')"
      >
        <IconTrash class="size-4" />
      </button>
    </div>
    <template v-if="isExpanded">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :selected="selected"
        :level="level + 1"
        :expanded-map="expandedMap"
        @select="(p) => emit('select', p)"
        @toggle="(p) => emit('toggle', p)"
        @delete="(p, t) => emit('delete', p, t)"
      />
    </template>
  </template>
  <div
    v-else
    class="group flex w-full items-center rounded-md hover:bg-accent"
    :class="selected === node.path && 'bg-accent text-accent-foreground'"
  >
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      :style="{ paddingLeft: `calc(0.5rem + ${indent})` }"
      @click="emit('select', node.path)"
    >
      <IconFile class="size-4 shrink-0 text-muted-foreground" />
      <span class="flex-1 truncate">{{ node.name }}</span>
      <span class="text-xs text-muted-foreground group-hover:hidden">{{ formatSize(node.size) }}</span>
    </button>
    <button
      type="button"
      class="mr-1 hidden shrink-0 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
      :title="`Delete ${node.path}`"
      @click.stop="emit('delete', node.path, 'file')"
    >
      <IconTrash class="size-4" />
    </button>
  </div>
</template>

