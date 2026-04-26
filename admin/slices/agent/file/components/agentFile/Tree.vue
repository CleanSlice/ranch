<script setup lang="ts">
import type { IFileNode } from '#agentFile/stores/agentFile';
import TreeNode from './TreeNode.vue';

interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

interface FileNode {
  type: 'file';
  name: string;
  path: string;
  size: number;
}

type TreeNode = FolderNode | FileNode;

const props = defineProps<{
  files: IFileNode[];
  selected: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', path: string): void;
}>();

const tree = computed<TreeNode[]>(() => buildTree(props.files));

function buildTree(files: IFileNode[]): TreeNode[] {
  const root: FolderNode = { type: 'folder', name: '', path: '', children: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      const path = segments.slice(0, i + 1).join('/');
      let child = cursor.children.find(
        (c): c is FolderNode => c.type === 'folder' && c.name === name,
      );
      if (!child) {
        child = { type: 'folder', name, path, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
    }
    cursor.children.push({
      type: 'file',
      name: segments[segments.length - 1],
      path: file.path,
      size: file.size,
    });
  }
  sortTree(root);
  return root.children;
}

function sortTree(node: FolderNode) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) {
    if (c.type === 'folder') sortTree(c);
  }
}

const expanded = ref<Record<string, boolean>>({});

function toggle(path: string) {
  expanded.value[path] = !expanded.value[path];
}

function isExpanded(path: string) {
  return expanded.value[path] ?? true;
}
</script>

<template>
  <div class="text-sm">
    <TreeNode
      v-for="node in tree"
      :key="node.path"
      :node="node"
      :selected="selected"
      :level="0"
      :expanded-map="expanded"
      @select="(p) => emit('select', p)"
      @toggle="toggle"
    />
    <div
      v-if="!tree.length"
      class="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
    >
      No files
    </div>
  </div>
</template>
