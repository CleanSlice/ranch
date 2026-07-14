<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#theme/components/ui/sheet';
import {
  IconAlertTriangle,
  IconDownload,
  IconFiles,
  IconRefresh,
  IconX,
} from '@tabler/icons-vue';
import { until } from '@vueuse/core';
import AgentFileTree from './Tree.vue';
import AgentFileViewer from './Viewer.vue';

const props = defineProps<{ id: string }>();

const store = useAgentFileStore();
const agentStore = useAgentStore();
const confirmStore = useConfirmStore();

const syncing = ref(false);
const syncError = ref<string | null>(null);
const syncMessage = ref<string | null>(null);

const downloading = ref(false);
const downloadError = ref<string | null>(null);

const deleting = ref(false);
const deleteError = ref<string | null>(null);

const selected = ref<string | null>(null);
const original = ref<string>('');
const content = ref<string>('');

const contentLoading = ref(false);
const contentError = ref<string | null>(null);
const loadingMore = ref(false);

// Pagination state for the currently-open file. `nextOffset === null` means
// the editor has the whole file. `totalSize` is the server-reported byte
// length of the underlying object (matches the file tree's size column).
const totalSize = ref<number>(0);
const nextOffset = ref<number | null>(null);
const hasMore = computed(() => nextOffset.value !== null);

const saving = ref(false);
const saveError = ref<string | null>(null);

const restarting = ref(false);
const restartError = ref<string | null>(null);

const sheetOpen = ref(false);

const dirty = computed(() => content.value !== original.value);
const pendingRestart = computed(() => store.isPendingRestart(props.id));

async function onSync() {
  syncing.value = true;
  syncError.value = null;
  syncMessage.value = null;
  let agentOnline = false;
  try {
    const result = await store.sync(props.id);
    agentOnline = result.agentOnline;
    syncMessage.value = result.agentOnline
      ? `Agent pushed ${result.pushed} file${result.pushed === 1 ? '' : 's'}`
      : 'Agent is offline — files are still up to date in S3';
  } catch (err) {
    syncError.value = (err as Error).message || 'Sync failed';
  }
  try {
    await store.fetchList(props.id);
  } catch (err) {
    syncError.value = (err as Error).message || 'Failed to load files';
  } finally {
    syncing.value = false;
  }
  // If we got fresh files from the agent, the on-disk version the user is
  // editing may now be stale. We don't auto-reload — just hint via message.
  if (agentOnline && selected.value && dirty.value) {
    syncMessage.value =
      (syncMessage.value ?? '') +
      ' — your unsaved changes were not affected.';
  }
}

async function openFile(path: string) {
  if (saving.value) {
    await until(saving).toBe(false);
  }
  if (dirty.value) {
    const ok = await confirmStore.ask({
      title: 'Discard unsaved changes?',
      description: 'You have unsaved edits in this file. They will be lost if you continue.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      variant: 'destructive',
    });
    if (!ok) return;
  }
  selected.value = path;
  contentLoading.value = true;
  contentError.value = null;
  saveError.value = null;
  totalSize.value = 0;
  nextOffset.value = null;
  sheetOpen.value = false;
  try {
    const chunk = await store.fetchContent(props.id, path);
    original.value = chunk.content;
    content.value = chunk.content;
    totalSize.value = chunk.totalSize;
    nextOffset.value = chunk.nextOffset;
  } catch (err) {
    original.value = '';
    content.value = '';
    contentError.value = (err as Error).message || 'Failed to load file';
  } finally {
    contentLoading.value = false;
  }
}

async function loadMore() {
  if (!selected.value || nextOffset.value === null || loadingMore.value) return;
  loadingMore.value = true;
  contentError.value = null;
  try {
    const chunk = await store.fetchContent(
      props.id,
      selected.value,
      nextOffset.value,
    );
    // Append to both `original` and `content` so `dirty` stays false until
    // the user actually edits something. (Editing is blocked while
    // `hasMore` is true — see Viewer — but this keeps the invariant honest.)
    original.value = original.value + chunk.content;
    content.value = content.value + chunk.content;
    nextOffset.value = chunk.nextOffset;
  } catch (err) {
    contentError.value = (err as Error).message || 'Failed to load more';
  } finally {
    loadingMore.value = false;
  }
}

async function onSave() {
  if (!selected.value || !dirty.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const updated = await store.save(props.id, selected.value, content.value);
    original.value = updated.content;
    content.value = updated.content;
  } catch (err) {
    saveError.value = (err as Error).message || 'Failed to save';
  } finally {
    saving.value = false;
  }
}

async function onRestart() {
  restarting.value = true;
  restartError.value = null;
  try {
    await agentStore.restart(props.id);
    store.clearPendingRestart(props.id);
  } catch (err) {
    restartError.value = (err as Error).message || 'Restart failed';
  } finally {
    restarting.value = false;
  }
}

function dismissRestartBanner() {
  store.clearPendingRestart(props.id);
}

async function onDelete(path: string, type: 'file' | 'folder') {
  if (deleting.value) return;
  const base =
    type === 'folder'
      ? 'This permanently deletes the folder and every file inside it from S3.'
      : 'This permanently deletes the file from S3.';
  // Skills synced from the template carry a managed marker and get rewritten
  // by syncSkills on every restart — deleting them here is only temporary.
  const skillNote = path.startsWith('skills/')
    ? ' If this skill is attached to the agent’s template, it will be re-created on the next restart — detach it from the template to remove it for good.'
    : '';
  const ok = await confirmStore.ask({
    title: `Delete ${type === 'folder' ? 'folder' : 'file'} "${path}"?`,
    description: base + skillNote,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
  });
  if (!ok) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    await store.remove(props.id, path, type === 'folder');
    const coversSelected =
      selected.value === path ||
      (type === 'folder' && selected.value?.startsWith(path + '/'));
    if (coversSelected) {
      selected.value = null;
      original.value = '';
      content.value = '';
      contentError.value = null;
      totalSize.value = 0;
      nextOffset.value = null;
    }
  } catch (err) {
    deleteError.value = (err as Error).message || 'Failed to delete';
  } finally {
    deleting.value = false;
  }
}

async function onDownload() {
  if (downloading.value) return;
  downloading.value = true;
  downloadError.value = null;
  try {
    await store.downloadZip(props.id);
  } catch (err) {
    downloadError.value = (err as Error).message || 'Download failed';
  } finally {
    downloading.value = false;
  }
}

// Lazy so this sub-provider doesn't re-suspend the page once the parent's
// agent data resolves and this component mounts.
useAsyncData(
  `admin-agent-files-${props.id}`,
  async () => {
    await store.fetchList(props.id);
    return true;
  },
  { lazy: true },
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="pendingRestart"
      class="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
    >
      <IconAlertTriangle class="size-4 shrink-0" />
      <p class="flex-1 min-w-[14rem]">
        File changes are saved. Restart the agent so it picks up the new files.
      </p>
      <p
        v-if="restartError"
        class="w-full truncate text-destructive"
        :title="restartError"
      >
        {{ restartError }}
      </p>
      <div class="flex items-center gap-2">
        <Button
          size="sm"
          :disabled="restarting"
          @click="onRestart"
        >
          <IconRefresh
            class="size-4"
            :class="restarting && 'animate-spin'"
          />
          {{ restarting ? 'Restarting…' : 'Restart agent' }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="restarting"
          @click="dismissRestartBanner"
        >
          <IconX class="size-4" />
        </Button>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Sheet v-model:open="sheetOpen">
          <SheetTrigger as-child>
            <Button variant="outline" size="sm" class="md:hidden">
              <IconFiles class="size-4" />
              Files
            </Button>
          </SheetTrigger>
          <SheetContent side="left" class="w-[85vw] sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>Files</SheetTitle>
            </SheetHeader>
            <div class="overflow-auto px-2 pb-4">
              <AgentFileTree
                :files="store.nodes"
                :selected="selected"
                @select="openFile"
                @delete="onDelete"
              />
            </div>
          </SheetContent>
        </Sheet>
        <p class="text-sm text-muted-foreground">
          {{ store.nodes.length }} files
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="downloading"
          @click="onDownload"
        >
          <IconDownload class="size-4" />
          {{ downloading ? 'Downloading…' : 'Download' }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="syncing"
          @click="onSync"
        >
          <IconRefresh class="size-4" :class="syncing && 'animate-spin'" />
          {{ syncing ? 'Syncing…' : 'Sync' }}
        </Button>
      </div>
    </div>

    <div
      v-if="downloadError"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {{ downloadError }}
    </div>
    <div
      v-if="deleteError"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {{ deleteError }}
    </div>
    <div
      v-if="syncError"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
      {{ syncError }}
    </div>
    <div
      v-else-if="syncMessage"
      class="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      {{ syncMessage }}
    </div>

    <div class="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
      <div class="hidden max-h-[640px] overflow-auto rounded-md border p-2 md:block">
        <AgentFileTree
          :files="store.nodes"
          :selected="selected"
          @select="openFile"
          @delete="onDelete"
        />
      </div>
      <div class="min-h-[480px]">
        <AgentFileViewer
          :path="selected"
          :content="content"
          :loading="contentLoading"
          :saving="saving"
          :load-error="contentError"
          :save-error="saveError"
          :dirty="dirty"
          :total-size="totalSize"
          :loaded-size="content.length"
          :has-more="hasMore"
          :loading-more="loadingMore"
          @update:content="(v: string) => (content = v)"
          @save="onSave"
          @load-more="loadMore"
        />
      </div>
    </div>
  </div>
</template>
