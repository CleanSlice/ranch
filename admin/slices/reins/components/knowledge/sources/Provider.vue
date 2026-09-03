<script setup lang="ts">
import { refDebounced, useIntervalFn } from '@vueuse/core';
import type {
  IImportJob,
  IKnowledge,
  ISource,
  ISourceFilter,
  ISourcePage,
  SourceIndexStatus,
  SourceType,
} from '#reins/stores/knowledge';
import { Download, Eye, Trash2 } from 'lucide-vue-next';
import { errorMessageOf, formatBytes, formatDate } from '#reins/domain';
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Input } from '#theme/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const route = useRoute();
const store = useKnowledgeStore();
const confirmStore = useConfirmStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const knowledgeId = computed(() => route.params.id as string);

// ---- filters ---------------------------------------------------------------

const PER_PAGE = 50;
const STATUS_OPTIONS: { value: SourceIndexStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'indexed', label: 'Indexed' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
];
const TYPE_OPTIONS: { value: SourceType | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'file', label: 'File' },
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Text' },
];

const search = ref('');
const searchDebounced = refDebounced(search, 300);
const status = ref<SourceIndexStatus | 'all'>('all');
const type = ref<SourceType | 'all'>('all');
const page = ref(1);

const filter = computed<ISourceFilter>(() => ({
  page: page.value,
  perPage: PER_PAGE,
  search: searchDebounced.value.trim() || undefined,
  status: status.value === 'all' ? undefined : status.value,
  type: type.value === 'all' ? undefined : type.value,
}));

// Any filter change starts from page 1 again.
watch([searchDebounced, status, type], () => {
  page.value = 1;
});

// ---- list ------------------------------------------------------------------

// Plain state rather than useAsyncData: this list is mutated from the page
// itself (add / delete / import / index) and has to reflect a write that just
// happened. useAsyncData caches per key in a payload shared across the app and
// neutralizes an entry once its last consumer unmounts, so a refresh() right
// after a mutation could resolve against a stale or detached entry and leave
// the table showing the pre-write list until a full page reload.
const pageData = ref<ISourcePage | null>(null);
const loading = ref(false);
const listError = ref<string | null>(null);

// Only the newest request may write to the state: filter changes and the 3s
// poll can overlap, and a slow earlier response must not overwrite a newer one.
let loadToken = 0;

async function load(): Promise<void> {
  const token = (loadToken += 1);
  loading.value = true;
  try {
    const result = await store.listSources(knowledgeId.value, filter.value);
    if (token !== loadToken) return;
    pageData.value = result;
    listError.value = null;
  } catch (err: unknown) {
    if (token !== loadToken) return;
    listError.value = errorMessageOf(err, 'Could not load sources');
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

await load();

watch(filter, () => {
  void load();
});

const rows = computed<ISource[]>(() => pageData.value?.items ?? []);
const total = computed(() => pageData.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PER_PAGE)));

// A run that finishes mid-way can shrink a filtered result set under the
// current page; snap back instead of showing an empty page.
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});

const hasFilter = computed(
  () => search.value.trim() !== '' || status.value !== 'all' || type.value !== 'all',
);

// ---- selection -------------------------------------------------------------

// Two modes and only two. `allMatching` means "every row this filter returns",
// which is the case the Export button exists for - a page-scoped select-all
// would quietly mean 50 of 356. Otherwise it is the ticked ids.
//
// While `allMatching` is on the row boxes are checked and disabled. "All except
// these three" cannot be expressed as a filter, so offering to untick one would
// either lie about what gets exported or need every id the user has never
// loaded. Leaving the mode is the way back.
const allMatching = ref(false);
const selectedIds = ref<Set<string>>(new Set());

const selectedCount = computed(() =>
  allMatching.value ? total.value : selectedIds.value.size,
);

// A different filter is a different result set; carrying a selection across it
// would export rows the user can no longer see.
watch(filter, () => {
  allMatching.value = false;
  selectedIds.value = new Set();
});

function isRowSelected(id: string): boolean {
  return allMatching.value || selectedIds.value.has(id);
}

function toggleRow(id: string, checked: boolean): void {
  const next = new Set(selectedIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
}

function clearSelection(): void {
  allMatching.value = false;
  selectedIds.value = new Set();
}

function toggleAll(checked: boolean): void {
  if (!checked) {
    clearSelection();
    return;
  }
  // Entering the mode drops any ticks: the two cannot both be in play, and
  // keeping them would make the count ambiguous.
  allMatching.value = true;
  selectedIds.value = new Set();
}

const exporting = ref(false);
const exportError = ref<string | null>(null);

async function handleExport(): Promise<void> {
  exporting.value = true;
  exportError.value = null;
  try {
    await store.exportSources(
      knowledgeId.value,
      allMatching.value
        ? {
            search: filter.value.search,
            status: filter.value.status,
            type: filter.value.type,
          }
        : { ids: [...selectedIds.value] },
    );
  } catch (err: unknown) {
    exportError.value = errorMessageOf(err, 'Export failed');
  } finally {
    exporting.value = false;
  }
}

// ---- background imports ----------------------------------------------------

const imports = ref<IImportJob[]>([]);

async function reloadImports() {
  try {
    imports.value = await store.listImports(knowledgeId.value);
  } catch {
    // Progress is a nicety; a failed poll must not break the page.
  }
}

await reloadImports();

const importRunning = computed(() =>
  imports.value.some((j) => j.status === 'running'),
);
const indexing = computed(() => current?.value?.indexStatus === 'indexing');

// While something is moving (index run, archive import) the list changes
// underneath the user, so keep it fresh; go quiet the moment it stops.
const { pause, resume } = useIntervalFn(
  async () => {
    await Promise.all([load(), reloadImports()]);
    if (indexing.value && refresh) await refresh();
  },
  3000,
  { immediate: false },
);

watch(
  [indexing, importRunning],
  ([isIndexing, isImporting]) => {
    if (isIndexing || isImporting) resume();
    else pause();
  },
  { immediate: true },
);

onBeforeUnmount(pause);

// ---- actions ---------------------------------------------------------------

const previewing = ref<ISource | null>(null);

async function handleDelete(source: ISource) {
  const ok = await confirmStore.ask({
    title: 'Delete source?',
    description: `Permanently delete source "${source.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
  });
  if (!ok) return;
  await store.removeSource(knowledgeId.value, source.id);
  await load();
  if (refresh) await refresh();
}

async function handleDownload(source: ISource) {
  await store.downloadSource(knowledgeId.value, source.id);
}

async function onAdded() {
  // The new rows land at the end of the list (oldest first), so a user sitting
  // on a later page or a filter would not see them; go back to a clean view.
  search.value = '';
  status.value = 'all';
  type.value = 'all';
  page.value = 1;
  await Promise.all([load(), reloadImports()]);
  if (refresh) await refresh();
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <Input
        v-model="search"
        placeholder="Search by name…"
        class="w-64"
      />
      <Select v-model="status">
        <SelectTrigger class="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="type">
        <SelectTrigger class="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <span class="ml-auto text-sm text-muted-foreground">
        {{ total }} source{{ total === 1 ? '' : 's' }}
        <template v-if="loading"> · updating…</template>
      </span>
      <KnowledgeSourcesAddSheet :knowledge-id="knowledgeId" @added="onAdded" />
    </div>

    <KnowledgeSourcesImportProgress :jobs="imports" />

    <div
      v-if="selectedCount > 0"
      class="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
    >
      <span>
        Selected <span class="font-medium">{{ selectedCount }}</span>
        of {{ total }}
        <template v-if="allMatching && hasFilter"> (current filter)</template>
      </span>
      <button
        type="button"
        class="text-muted-foreground underline-offset-2 hover:underline"
        @click="clearSelection"
      >
        Clear
      </button>
      <Button
        size="sm"
        class="ml-auto"
        :disabled="exporting"
        @click="handleExport"
      >
        {{ exporting ? 'Preparing…' : `Export ${selectedCount} as zip` }}
      </Button>
    </div>

    <p v-if="exportError" class="text-sm text-destructive">
      Export failed: {{ exportError }}
    </p>

    <p v-if="listError" class="text-sm text-destructive">
      Could not load sources: {{ listError }}
    </p>

    <div v-if="rows.length" class="min-w-0 overflow-hidden rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-10">
              <Checkbox
                :model-value="allMatching"
                aria-label="Select every source matching the current filter"
                @update:model-value="
                  (v: boolean | 'indeterminate') => toggleAll(v === true)
                "
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead class="w-20">Type</TableHead>
            <TableHead class="w-24">Size</TableHead>
            <TableHead class="w-64">Status</TableHead>
            <TableHead class="w-28">Added</TableHead>
            <TableHead class="w-28 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in rows" :key="s.id">
            <TableCell>
              <Checkbox
                :model-value="isRowSelected(s.id)"
                :disabled="allMatching"
                :aria-label="`Select ${s.name}`"
                @update:model-value="
                  (v: boolean | 'indeterminate') => toggleRow(s.id, v === true)
                "
              />
            </TableCell>
            <TableCell class="max-w-md font-medium">
              <a
                v-if="s.type === 'url' && s.url"
                :href="s.url"
                target="_blank"
                rel="noopener"
                class="block truncate underline-offset-2 hover:underline"
                :title="s.url"
              >
                {{ s.name }}
              </a>
              <span v-else class="block truncate" :title="s.name">{{ s.name }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ s.type }}</TableCell>
            <TableCell class="text-muted-foreground">{{ formatBytes(s.sizeBytes) }}</TableCell>
            <TableCell>
              <!-- The width cap is not cosmetic: an index error is one long
                   unbreakable line (chunk ids, model names), and without a
                   ceiling its min-content width sets the width of the whole
                   table and pushes the page sideways. -->
              <div class="flex max-w-60 flex-col gap-1">
                <KnowledgeSourceStatusBadge :status="s.indexStatus" class="w-fit" />
                <span
                  v-if="s.indexStatus === 'failed' && s.indexError"
                  class="line-clamp-2 text-xs break-words text-destructive"
                  :title="s.indexError"
                >
                  {{ s.indexError }}
                </span>
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(s.createdAt) }}</TableCell>
            <TableCell class="text-right">
              <!-- Icons rather than three word-buttons: the labels cost more
                   horizontal room than the Name column had to spare, and these
                   three actions are the same on every row. -->
              <div class="flex justify-end gap-0.5">
                <Button
                  v-if="s.type !== 'url'"
                  size="icon-sm"
                  variant="ghost"
                  title="Preview"
                  @click="previewing = s"
                >
                  <Eye class="size-4" />
                  <span class="sr-only">Preview {{ s.name }}</span>
                </Button>
                <Button
                  v-if="s.type !== 'url'"
                  size="icon-sm"
                  variant="ghost"
                  title="Download"
                  @click="handleDownload(s)"
                >
                  <Download class="size-4" />
                  <span class="sr-only">Download {{ s.name }}</span>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  class="text-destructive"
                  title="Delete"
                  @click="handleDelete(s)"
                >
                  <Trash2 class="size-4" />
                  <span class="sr-only">Delete {{ s.name }}</span>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else-if="!loading && !listError"
      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      <template v-if="hasFilter">No sources match these filters.</template>
      <template v-else>No sources yet. Add one above, then run Index.</template>
    </div>

    <div v-if="pageCount > 1" class="flex items-center justify-end gap-2 text-sm">
      <span class="text-muted-foreground">
        Page {{ page }} of {{ pageCount }} · {{ total }} total
      </span>
      <Button size="sm" variant="outline" :disabled="page <= 1" @click="page--">
        Prev
      </Button>
      <Button size="sm" variant="outline" :disabled="page >= pageCount" @click="page++">
        Next
      </Button>
    </div>

    <KnowledgeSourcesPreviewSheet
      :knowledge-id="knowledgeId"
      :source="previewing"
      @close="previewing = null"
    />
  </div>
</template>
