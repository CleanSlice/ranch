<script setup lang="ts">
import Sigma from 'sigma';
import type { SigmaNodeEventPayload, SigmaEdgeEventPayload } from 'sigma/types';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { GraphDto, GraphNodeDto, GraphEdgeDto } from '#api/data';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';

const store = useKnowledgeStore();

const container = ref<HTMLElement | null>(null);
const labels = ref<string[]>([]);
const selectedLabel = ref<string>('*');
const maxDepth = ref<number>(3);
const maxNodes = ref<number>(100);
const loading = ref<boolean>(false);
const errorMessage = ref<string | null>(null);
const truncated = ref<boolean>(false);
const selectedNode = ref<GraphNodeDto | null>(null);
const selectedEdge = ref<GraphEdgeDto | null>(null);
const nodes = ref<GraphNodeDto[]>([]);

let renderer: Sigma | null = null;
let graph: Graph | null = null;
const nodeIndex = new Map<string, GraphNodeDto>();
const edgeIndex = new Map<string, GraphEdgeDto>();

function hslToHex(h: number, s: number, l: number): string {
  const lf = l / 100;
  const a = (s * Math.min(lf, 1 - lf)) / 100;
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = lf - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function colorForType(entityType: string): string {
  let hash = 0;
  for (let i = 0; i < entityType.length; i += 1) {
    hash = (hash * 31 + entityType.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 65, 55);
}

function ensureRenderer(): Sigma {
  if (renderer && graph) return renderer;
  if (!container.value) {
    throw new Error('Graph container not mounted');
  }
  graph = new Graph({ multi: true });
  renderer = new Sigma(graph, container.value, {
    renderEdgeLabels: false,
    defaultEdgeColor: '#cbd5e1',
    defaultNodeColor: '#94a3b8',
    labelColor: { color: '#0f172a' },
    labelSize: 12,
    labelWeight: '500',
    labelDensity: 0.6,
    labelGridCellSize: 80,
    labelRenderedSizeThreshold: 6,
    minCameraRatio: 0.1,
    maxCameraRatio: 10,
  });

  renderer.on('clickNode', (payload: SigmaNodeEventPayload) => {
    selectedNode.value = nodeIndex.get(payload.node) ?? null;
    selectedEdge.value = null;
  });

  renderer.on('clickEdge', (payload: SigmaEdgeEventPayload) => {
    selectedEdge.value = edgeIndex.get(payload.edge) ?? null;
    selectedNode.value = null;
  });

  renderer.on('clickStage', () => {
    selectedNode.value = null;
    selectedEdge.value = null;
  });

  return renderer;
}

function renderGraph(data: GraphDto): void {
  ensureRenderer();
  if (!graph) return;

  graph.clear();
  nodeIndex.clear();
  edgeIndex.clear();
  for (const node of data.nodes) nodeIndex.set(node.id, node);
  for (const edge of data.edges) edgeIndex.set(edge.id, edge);
  nodes.value = data.nodes;

  const nodeSize = data.nodes.length > 50 ? 6 : data.nodes.length > 20 ? 8 : 10;

  for (const node of data.nodes) {
    graph.addNode(node.id, {
      x: Math.random(),
      y: Math.random(),
      size: nodeSize,
      label: node.label,
      color: colorForType(node.entityType),
    });
  }

  for (const edge of data.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    const size = Math.max(0.5, Math.min(3, edge.weight));
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      size,
      color: '#cbd5e1',
    });
  }

  if (graph.order > 0) {
    const settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 200,
      settings: {
        ...settings,
        gravity: 1,
        scalingRatio: 10,
      },
    });
    normalizeAndFit();
  }

  renderer?.refresh();
}

function normalizeAndFit(): void {
  if (!graph || !renderer) return;
  const g = graph;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  g.forEachNode((_, attrs) => {
    if (typeof attrs.x === 'number') {
      minX = Math.min(minX, attrs.x);
      maxX = Math.max(maxX, attrs.x);
    }
    if (typeof attrs.y === 'number') {
      minY = Math.min(minY, attrs.y);
      maxY = Math.max(maxY, attrs.y);
    }
  });
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const scale = 1 / Math.max(dx, dy);
  g.forEachNode((node, attrs) => {
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') return;
    g.setNodeAttribute(node, 'x', (attrs.x - minX) * scale);
    g.setNodeAttribute(node, 'y', (attrs.y - minY) * scale);
  });
  renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1.15, angle: 0 });
}

async function loadLabels(): Promise<void> {
  labels.value = await store.getGraphLabels();
}

async function loadGraph(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  selectedNode.value = null;
  selectedEdge.value = null;
  try {
    const data = await store.getGraph(
      selectedLabel.value,
      maxDepth.value,
      maxNodes.value,
    );
    truncated.value = data.isTruncated;
    renderGraph(data);
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

const entityTypeStats = computed<Array<[string, number]>>(() => {
  const counts = new Map<string, number>();
  for (const node of nodes.value) {
    counts.set(node.entityType, (counts.get(node.entityType) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
});

let firstLoad = true;
watch(selectedLabel, () => {
  if (firstLoad) return;
  void loadGraph();
});

onMounted(async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    await loadLabels();
    await loadGraph();
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
    firstLoad = false;
  }
});

onBeforeUnmount(() => {
  renderer?.kill();
  renderer = null;
  graph = null;
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end gap-3">
      <div class="grid gap-1">
        <Label class="text-xs text-muted-foreground">Entity</Label>
        <Select v-model="selectedLabel">
          <SelectTrigger class="w-64">
            <SelectValue placeholder="Pick an entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="*">* (all)</SelectItem>
            <SelectItem v-for="l in labels" :key="l" :value="l">
              {{ l }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-1">
        <Label class="text-xs text-muted-foreground">Max depth</Label>
        <Input
          v-model.number="maxDepth"
          type="number"
          min="1"
          max="10"
          class="w-24"
        />
      </div>
      <div class="grid gap-1">
        <Label class="text-xs text-muted-foreground">Max nodes</Label>
        <Input
          v-model.number="maxNodes"
          type="number"
          min="1"
          max="5000"
          class="w-28"
        />
      </div>
      <Button :disabled="loading" @click="loadGraph">
        {{ loading ? 'Loading…' : 'Reload' }}
      </Button>
      <span v-if="truncated" class="text-xs text-amber-600">
        Result truncated — increase Max nodes to see more
      </span>
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <div class="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div
        ref="container"
        class="h-[600px] w-full rounded-md border bg-card"
      />
      <div class="flex flex-col gap-4">
        <div class="rounded-md border bg-card p-3">
          <h3 class="mb-2 text-sm font-semibold">Legend</h3>
          <div v-if="entityTypeStats.length" class="flex flex-col gap-1.5">
            <div
              v-for="[type, count] in entityTypeStats"
              :key="type"
              class="flex items-center gap-2 text-xs"
            >
              <span
                class="size-3 rounded-full"
                :style="{ backgroundColor: colorForType(type) }"
              />
              <span class="flex-1 truncate">{{ type }}</span>
              <span class="text-muted-foreground">{{ count }}</span>
            </div>
          </div>
          <p v-else class="text-xs text-muted-foreground">
            No data
          </p>
        </div>

        <div v-if="selectedNode" class="rounded-md border bg-card p-3">
          <h3 class="mb-1 text-sm font-semibold truncate">
            {{ selectedNode.label }}
          </h3>
          <p class="mb-2 text-xs text-muted-foreground">
            {{ selectedNode.entityType }}
          </p>
          <p class="text-xs">{{ selectedNode.description || 'No description' }}</p>
        </div>

        <div v-else-if="selectedEdge" class="rounded-md border bg-card p-3">
          <h3 class="mb-1 text-sm font-semibold">Relationship</h3>
          <p v-if="selectedEdge.keywords" class="mb-2 text-xs text-muted-foreground">
            {{ selectedEdge.keywords }}
          </p>
          <p class="text-xs">{{ selectedEdge.description || 'No description' }}</p>
        </div>

        <p v-else class="text-xs text-muted-foreground">
          Click a node or edge to see details.
        </p>
      </div>
    </div>
  </div>
</template>
