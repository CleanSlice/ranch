<script setup lang="ts">
import { IconFile, IconFolder, IconFolderOpen } from '@tabler/icons-vue';

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
}>();

const isExpanded = computed(() =>
  props.node.type === 'folder' ? props.expandedMap[props.node.path] ?? true : false,
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
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
      :style="{ paddingLeft: `calc(0.5rem + ${indent})` }"
      @click="emit('toggle', node.path)"
    >
      <IconFolderOpen v-if="isExpanded" class="size-4 shrink-0 text-muted-foreground" />
      <IconFolder v-else class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ node.name }}</span>
    </button>
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
      />
    </template>
  </template>
  <button
    v-else
    type="button"
    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
    :class="selected === node.path && 'bg-accent text-accent-foreground'"
    :style="{ paddingLeft: `calc(0.5rem + ${indent})` }"
    @click="emit('select', node.path)"
  >
    <IconFile class="size-4 shrink-0 text-muted-foreground" />
    <span class="flex-1 truncate">{{ node.name }}</span>
    <span class="text-xs text-muted-foreground">{{ formatSize(node.size) }}</span>
  </button>
</template>

