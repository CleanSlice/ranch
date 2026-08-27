<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import type { IKnowledge, ISource } from '#reins/stores/knowledge';

const route = useRoute();
const store = useKnowledgeStore();
const confirmStore = useConfirmStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const sources = ref<ISource[]>([]);
const loading = ref(false);

async function reload() {
  loading.value = true;
  try {
    sources.value = await store.listSources(route.params.id as string);
  } finally {
    loading.value = false;
  }
}

await reload();

// While anything is processing, keep the per-source states live so the
// operator watches the batch move instead of re-clicking (US6).
const { pause, resume } = useIntervalFn(
  async () => {
    sources.value = await store.listSources(route.params.id as string);
    if (!sources.value.some((s) => s.indexState === 'processing')) pause();
  },
  4000,
  { immediate: false },
);
watch(
  () => sources.value.some((s) => s.indexState === 'processing'),
  (busy) => {
    if (busy) resume();
    else pause();
  },
  { immediate: true },
);
onBeforeUnmount(() => pause());

const stateBadge: Record<
  ISource['indexState'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  queued: { label: 'Queued', variant: 'outline' },
  processing: { label: 'Processing…', variant: 'secondary' },
  indexed: { label: 'Indexed', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
};

async function handleReindex(source: ISource) {
  await store.reindexSource(route.params.id as string, source.id);
  await reload();
  resume();
}

async function handleDelete(source: ISource) {
  const ok = await confirmStore.ask({
    title: 'Delete source?',
    description: `Permanently delete source "${source.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
  });
  if (!ok) return;
  await store.removeSource(route.params.id as string, source.id);
  await reload();
  if (refresh) await refresh();
}

async function onAdded() {
  await reload();
  if (refresh) await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <KnowledgeSourcesAddForm
      :knowledge-id="(route.params.id as string)"
      @added="onAdded"
    />

    <KnowledgeSourcesAddFromSitemapForm
      :knowledge-id="(route.params.id as string)"
      @added="onAdded"
    />

    <KnowledgeSourcesAddFromArchiveForm
      :knowledge-id="(route.params.id as string)"
      @added="onAdded"
    />

    <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="sources.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in sources" :key="s.id">
            <TableCell class="font-medium">{{ s.name }}</TableCell>
            <TableCell class="text-muted-foreground">{{ s.type }}</TableCell>
            <TableCell>
              <div class="flex flex-col gap-0.5">
                <Badge
                  :variant="stateBadge[s.indexState].variant"
                  class="w-fit"
                >
                  {{ stateBadge[s.indexState].label }}
                </Badge>
                <span
                  v-if="s.indexState === 'failed' && s.indexError"
                  class="max-w-md text-xs text-destructive"
                >
                  {{ s.indexError }}
                </span>
              </div>
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-2">
                <Button
                  v-if="s.indexState === 'failed'"
                  size="sm"
                  variant="outline"
                  @click="handleReindex(s)"
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  @click="handleDelete(s)"
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else
      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      No sources yet. Add one above, then run Index.
    </div>
  </div>
</template>
