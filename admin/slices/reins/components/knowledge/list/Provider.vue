<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';

const store = useKnowledgeStore();
const confirmStore = useConfirmStore();

const search = ref('');
const page = ref(1);

// Server-side search and paging: the list never renders every base in the
// installation at once, and finding one never requires scanning (FR-009).
const [{ data: result, pending, refresh }] = await Promise.all([
  useAsyncData(
    'admin-reins-knowledges',
    () => store.fetchPage(search.value.trim() || undefined, page.value),
    { watch: [page] },
  ),
  useAsyncData('admin-reins-status', () => store.fetchStatus()),
]);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void refresh();
  }, 250);
});

const items = computed<IKnowledge[]>(() => result.value?.items ?? []);
const total = computed(() => result.value?.total ?? 0);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / (result.value?.perPage ?? 50))),
);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

async function onRemove(item: IKnowledge) {
  const ok = await confirmStore.ask({
    title: 'Delete knowledge?',
    description: `Permanently delete knowledge "${item.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
  });
  if (!ok) return;
  await store.remove(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Knowledges</h1>
        <p class="text-sm text-muted-foreground">
          Knowledge bases backed by LightRAG. Create one, add sources, then index.
        </p>
      </div>
      <Button v-if="store.enabled" as-child>
        <NuxtLink to="/knowledges/create">New knowledge</NuxtLink>
      </Button>
      <Button v-else disabled>New knowledge</Button>
    </div>

    <div
      v-if="!store.enabled"
      class="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
    >
      Knowledge service is disabled. Set the URL in
      <NuxtLink to="/settings" class="underline">Settings → Knowledge service</NuxtLink>
      to enable knowledges.
    </div>

    <Input
      v-model="search"
      placeholder="Search by name, description or source"
      class="max-w-sm"
    />

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="items.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in items"
            :key="item.id"
            class="cursor-pointer"
            @click="navigateTo(`/knowledges/${item.id}`)"
          >
            <TableCell class="font-medium">{{ item.name }}</TableCell>
            <TableCell>{{ item.sourcesCount ?? 0 }}</TableCell>
            <TableCell class="text-muted-foreground">
              {{ formatSize(item.totalSizeBytes) }}
            </TableCell>
            <TableCell>
              <IndexStatusBadge :status="item.indexStatus" />
            </TableCell>
            <TableCell class="text-muted-foreground">
              {{ formatDate(item.updatedAt) }}
            </TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/knowledges/${item.id}/edit`">Edit</NuxtLink>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  @click="onRemove(item)"
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
      v-else-if="search.trim()"
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      No base matches “{{ search.trim() }}”. Clear the search to see all
      {{ total }} bases.
    </div>
    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      No knowledge bases yet. Create one to start answering questions from
      your own content.
    </div>

    <div
      v-if="pageCount > 1"
      class="flex items-center justify-between text-sm text-muted-foreground"
    >
      <span>{{ total }} bases · page {{ page }} of {{ pageCount }}</span>
      <div class="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="page <= 1"
          @click="page -= 1"
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="page >= pageCount"
          @click="page += 1"
        >
          Next
        </Button>
      </div>
    </div>
  </div>
</template>
