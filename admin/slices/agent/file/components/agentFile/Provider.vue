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
  IconExternalLink,
  IconFile,
  IconFiles,
  IconPlus,
  IconRefresh,
  IconUpload,
  IconX,
} from '@tabler/icons-vue';
import { SaveRefusedError } from '#agentFile/domain';
import { useAgentFileStore } from '#agentFile/stores/agentFile';
import { basename, formatBytes, formatModified } from '#agentFile/utils/format';
import AgentFileExplorer from './Explorer.vue';
import AgentFileNewFileDialog from './NewFileDialog.vue';
import AgentFileTabs from './Tabs.vue';
import AgentFileEditor from './Editor.vue';
import AgentFileImportDialog from './ImportDialog.vue';
import AgentFileDiffView from './DiffView.vue';
import { useFileProposalStore, ProposalRemoveConfirmNeeded } from '#agentFile/stores/fileProposal';

const props = defineProps<{ id: string }>();

const importOpen = ref(false);
const newFileOpen = ref(false);
const proposalStore = useFileProposalStore();

// ── Explorer: selection and bulk actions (US5) ─────────────────────
const selection = computed(() => store.selectionFor(props.id));
const dirtyPaths = computed(() => store.dirtyPaths(props.id));
const bulkBusy = ref(false);

function onSelectionChange(paths: string[]) {
  store.setSelection(props.id, paths);
}

async function onBulkDownload(paths: string[]) {
  await onDownload(paths);
}

async function onBulkDelete(paths: string[]) {
  if (!paths.length || bulkBusy.value) return;
  const skillNote = paths.some((p) => p.startsWith('skills/'))
    ? ' Skills attached to the agent’s template are re-created on the next restart.'
    : '';
  const ok = await confirmStore.ask({
    title: `Delete ${paths.length} file${paths.length === 1 ? '' : 's'}?`,
    description: `This permanently deletes the selected files from S3.${skillNote}`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
  });
  if (!ok) return;
  bulkBusy.value = true;
  actionError.value = null;
  try {
    let outcome = await store.removeMany(props.id, paths);
    if (outcome.status === 'conflict') {
      const sure = await confirmStore.ask({
        title: 'This empties the whole workspace',
        description: `The selection covers all ${outcome.conflict.total} files. The agent would boot with nothing — its identity, memory and skills gone. Download the workspace first if you might need it.`,
        confirmLabel: 'Delete everything',
        cancelLabel: 'Keep the files',
        variant: 'destructive',
      });
      if (!sure) return;
      outcome = await store.removeMany(props.id, paths, true);
    }
    if (outcome.status === 'done') {
      syncMessage.value = `Deleted ${outcome.deleted} file${outcome.deleted === 1 ? '' : 's'}`;
    }
  } catch (err) {
    actionError.value = (err as Error).message || 'Delete failed';
  } finally {
    bulkBusy.value = false;
  }
}

async function onCreated(path: string) {
  await store.open(props.id, path);
}

/** Folder of the active file, offered as the default for New file. */
const activeFolder = computed(() => {
  const p = active.value;
  if (!p || !p.includes('/')) return null;
  return p.slice(0, p.lastIndexOf('/'));
});

// ── Chat proposals in the editor (CLEAN-112, US4) ──────────────────
// `?proposal=<id>` opens the target file with the proposed content as an
// unsaved draft; Save then applies the proposal (via: editor). `&compare=1`
// shows the stored and proposed versions side by side instead.
const compare = ref<{
  path: string;
  original: string;
  modified: string;
  originalLabel: string;
  modifiedLabel: string;
} | null>(null);
const compareError = ref<string | null>(null);

async function openProposal(proposalId: string, wantCompare: boolean) {
  try {
    const proposal = await proposalStore.fetch(props.id, proposalId);
    if (proposal.kind !== 'single' || !proposal.path) {
      actionError.value = 'This proposal imports a whole archive — apply it from the chat card.';
      return;
    }
    const proposed = await proposalStore.content(props.id, proposalId);
    const path = proposal.path;
    const exists = !!store.nodeFor(props.id, path);
    if (exists) {
      await store.open(props.id, path);
      // Wait for the whole file: a draft over a partial file would truncate it.
      let loaded = store.loadedFor(props.id, path);
      while (loaded && loaded.hasMore) {
        loaded = await store.fetchMore(props.id, path);
      }
    } else {
      // A `create` proposal: nothing stored yet — the editor opens empty.
      store.upsertNode(props.id, {
        path,
        size: 0,
        updatedAt: '',
        kind: 'text',
        editable: true,
      });
      if (!store.tabsFor(props.id).includes(path)) {
        store.openTabs = { ...store.openTabs, [props.id]: [...store.tabsFor(props.id), path] };
      }
      store.activate(props.id, path);
    }
    if (wantCompare) {
      await showCompare(path, proposed, proposal.status === 'pending' ? 'proposed' : `proposed · ${proposal.status}`);
    }
    if (proposal.status === 'pending') {
      store.setDraft(props.id, path, proposed, proposalId);
    } else if (!wantCompare) {
      actionError.value = `This proposal is already ${proposal.status}.`;
    }
  } catch (err) {
    actionError.value = (err as Error).message || 'Could not open the proposal';
  }
}

async function showCompare(path: string, proposed: string, label = 'proposed') {
  compareError.value = null;
  const lim = limits.value;
  const cap = lim?.diffCompareMaxBytes ?? Number.POSITIVE_INFINITY;
  const loaded = store.loadedFor(props.id, path);
  const original = loaded?.content ?? '';
  if (new Blob([proposed]).size > cap || (loaded?.totalSize ?? 0) > cap) {
    compareError.value = 'Too large to compare — download both versions instead.';
    return;
  }
  compare.value = { path, original, modified: proposed, originalLabel: 'stored', modifiedLabel: label };
}

async function onCompare() {
  const path = active.value;
  if (!path) return;
  const draft = store.draftFor(props.id, path);
  if (!draft) return;
  await showCompare(path, draft.content, draft.proposalId ? 'proposed' : 'draft');
}

async function onImported() {
  // The store already refetched the list; the agent row carries the status
  // the restart hint depends on.
  await agentStore.fetchById(props.id).catch(() => null);
}

const store = useAgentFileStore();
const agentStore = useAgentStore();
const confirmStore = useConfirmStore();
const route = useRoute();
const router = useRouter();

// ── Agent copy hint (CLEAN-50) ─────────────────────────────────────
// While the agent is Running, this tab shows the S3 copy but the pod works on
// its own. Read from the agent store's record (docs/state.md).
const agent = computed(() => agentStore.byId(props.id));
const agentRunning = computed(() => agent.value?.status === 'running');

function formatClock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const copyPill = computed(() => {
  if (!agentRunning.value) return null;
  const pulled = formatClock(agent.value?.lastPullAt ?? null);
  return pulled ? `Agent copy is newer (${pulled})` : 'Agent works on its own copy';
});

const copyPillTitle = computed(() => {
  const pulled = agent.value?.lastPullAt ? new Date(agent.value.lastPullAt).toLocaleString() : null;
  const synced = agent.value?.lastSyncAt ? new Date(agent.value.lastSyncAt).toLocaleString() : null;
  const parts = [
    'This tab shows the stored (S3) copy. The running agent works on its own copy and may hold newer content — Sync brings it in.',
  ];
  if (pulled) parts.push(`Agent took its copy ${pulled}.`);
  if (synced) parts.push(`Last sync ${synced}.`);
  return parts.join(' ');
});

// ── Files, tabs, active file ───────────────────────────────────────
const nodes = computed(() => store.nodesFor(props.id));
const totalBytes = computed(() => nodes.value.reduce((s, n) => s + n.size, 0));
const tabs = computed(() => store.tabsFor(props.id));
const active = computed(() => store.activeFor(props.id));
const activeNode = computed(() => (active.value ? store.nodeFor(props.id, active.value) : null));
const activeLoaded = computed(() => (active.value ? store.loadedFor(props.id, active.value) : null));
const dirtyMap = computed(() =>
  Object.fromEntries(tabs.value.map((p) => [p, store.isDirty(props.id, p)])),
);
const anyDirty = computed(() => store.dirtyPaths(props.id).length > 0);
const limits = computed(() => store.limits);

/** Binary, or a text file too large to stream: the panel instead of the editor. */
const activeMode = computed<'editor' | 'panel' | 'none'>(() => {
  if (!active.value) return 'none';
  const node = activeNode.value;
  const loaded = activeLoaded.value;
  const kind = loaded?.kind ?? node?.kind ?? 'text';
  const size = loaded?.totalSize || node?.size || 0;
  if (kind === 'binary') return 'panel';
  if (limits.value && size > limits.value.maxViewBytes) return 'panel';
  if (loaded?.error && !loaded.content) return 'panel';
  return 'editor';
});

const sheetOpen = ref(false);
const pendingRestart = computed(() => store.isPendingRestart(props.id));

const syncing = ref(false);
const syncError = ref<string | null>(null);
const syncMessage = ref<string | null>(null);
const downloading = ref(false);
const actionError = ref<string | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);
const restarting = ref(false);
const restartError = ref<string | null>(null);
const opening = ref(false);

// ── Open / close ───────────────────────────────────────────────────
async function openFile(path: string) {
  sheetOpen.value = false;
  saveError.value = null;
  const node = store.nodeFor(props.id, path);
  const tooLarge = limits.value && node && node.size > limits.value.maxViewBytes;
  if (node?.kind === 'binary' || tooLarge) {
    // No slice to fetch — the panel renders from the node alone.
    if (!tabs.value.includes(path)) {
      store.openTabs = { ...store.openTabs, [props.id]: [...tabs.value, path] };
    }
    store.activate(props.id, path);
    return;
  }
  await store.open(props.id, path);
}

async function closeTab(path: string) {
  if (store.isDirty(props.id, path)) {
    const ok = await confirmStore.ask({
      title: `Discard unsaved changes in ${basename(path)}?`,
      description: 'The edits in this file will be lost.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      variant: 'destructive',
    });
    if (!ok) return;
  }
  store.closeTab(props.id, path);
}

function onDiscard() {
  if (active.value) store.clearDraft(props.id, active.value);
}

// ── Save with conflict handling (FR-005) ───────────────────────────
async function onSave() {
  const path = active.value;
  if (!path || !store.isDirty(props.id, path) || saving.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const draft = store.draftFor(props.id, path);
    if (draft?.proposalId) {
      // Saving a proposal draft applies the proposal with the edited text —
      // the card in the chat flips through the proposal_update event.
      try {
        const row = await proposalStore.apply(props.id, draft.proposalId, 'editor', {
          content: draft.content,
        });
        if (row.status !== 'applied') {
          saveError.value =
            row.status === 'stale'
              ? 'The file changed since this was proposed — reload it and ask the agent to propose again.'
              : `The proposal is ${row.status}${row.reason ? `: ${row.reason}` : ''}.`;
          return;
        }
        store.clearDraft(props.id, path);
        await store.fetchContent(props.id, path, true);
        await store.fetchList(props.id);
        store.markPendingRestart(props.id);
      } catch (err) {
        if (err instanceof ProposalRemoveConfirmNeeded) {
          saveError.value = 'Replace imports are applied from the chat card.';
        } else {
          saveError.value = (err as Error).message || 'Failed to apply';
        }
      }
      return;
    }
    await store.save(props.id, path);
  } catch (err) {
    if (err instanceof SaveRefusedError && err.reason === 'conflict') {
      const overwrite = await confirmStore.ask({
        title: 'This file changed since you opened it',
        description:
          'Someone (the agent, a Sync, an import or another operator) saved a newer version. ' +
          'Overwrite it with your edit, or cancel to reload the stored version and keep your edit as a draft.',
        confirmLabel: 'Overwrite',
        cancelLabel: 'Reload',
        variant: 'destructive',
      });
      try {
        if (overwrite) {
          await store.save(props.id, path, undefined, { overwrite: true });
        } else {
          const draft = store.draftFor(props.id, path)?.content;
          await store.fetchContent(props.id, path, true);
          if (draft !== undefined) store.setDraft(props.id, path, draft);
          saveError.value = 'Reloaded the stored version — your edit is still in the editor as an unsaved draft.';
        }
      } catch (inner) {
        saveError.value = (inner as Error).message || 'Failed to save';
      }
    } else {
      saveError.value = (err as Error).message || 'Failed to save';
    }
  } finally {
    saving.value = false;
  }
}

// ── Open full / download ───────────────────────────────────────────
async function onOpenFull(path: string) {
  opening.value = true;
  actionError.value = null;
  try {
    await store.openFull(props.id, path);
  } catch (err) {
    actionError.value = (err as Error).message || 'Could not open the file';
  } finally {
    opening.value = false;
  }
}

async function onDownload(paths?: string[]) {
  if (downloading.value) return;
  downloading.value = true;
  actionError.value = null;
  try {
    await store.downloadZip(props.id, paths);
  } catch (err) {
    actionError.value = (err as Error).message || 'Download failed';
  } finally {
    downloading.value = false;
  }
}

// ── Sync (CLEAN-50 guard) ──────────────────────────────────────────
function describeAtRisk(files: { path: string }[]): string {
  const MAX_LISTED = 8;
  const listed = files.slice(0, MAX_LISTED).map((f) => f.path).join(', ');
  const rest = files.length - MAX_LISTED;
  return rest > 0 ? `${listed} and ${rest} more` : listed;
}

async function onSync() {
  syncing.value = true;
  syncError.value = null;
  syncMessage.value = null;
  try {
    let outcome = await store.sync(props.id);
    if (outcome.status === 'conflict') {
      const { atRisk } = outcome.conflict;
      const ok = await confirmStore.ask({
        title: 'Overwrite newer files in S3?',
        description:
          `${atRisk.length} file${atRisk.length === 1 ? ' was' : 's were'} ` +
          'edited in S3 after the running agent last took its copy: ' +
          `${describeAtRisk(atRisk)}. ` +
          'If the agent also changed them, Sync will overwrite the S3 ' +
          'version with the agent’s copy. Files changed only in S3 are safe.',
        confirmLabel: 'Sync anyway',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      });
      if (!ok) {
        syncing.value = false;
        return;
      }
      outcome = await store.sync(props.id, true);
    }
    if (outcome.status === 'done') {
      const result = outcome.result;
      syncMessage.value = result.agentOnline
        ? `Agent pushed ${result.pushed} file${result.pushed === 1 ? '' : 's'}`
        : 'Agent is offline — files are still up to date in S3';
      if (result.agentOnline && anyDirty.value) {
        syncMessage.value += ' — your unsaved changes were not affected.';
      }
    }
  } catch (err) {
    syncError.value = (err as Error).message || 'Sync failed';
  }
  try {
    // Refetch the agent row alongside the files: lastSyncAt just changed and
    // no SSE frame will carry it — without this the pill shows the old time.
    await Promise.all([
      agentStore.fetchById(props.id).catch(() => null),
      store.fetchList(props.id),
    ]);
    // Open files may have new content in S3; reload the ones without a draft.
    for (const p of tabs.value) {
      if (!store.isDirty(props.id, p) && store.loadedFor(props.id, p)) {
        void store.fetchContent(props.id, p, true);
      }
    }
  } catch (err) {
    syncError.value = (err as Error).message || 'Failed to load files';
  } finally {
    syncing.value = false;
  }
}

// ── Restart ────────────────────────────────────────────────────────
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

// ── Delete (single, from the tree) ─────────────────────────────────
async function onDelete(path: string, type: 'file' | 'folder') {
  const base =
    type === 'folder'
      ? 'This permanently deletes the folder and every file inside it from S3.'
      : 'This permanently deletes the file from S3.';
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
  actionError.value = null;
  try {
    await store.remove(props.id, path, type === 'folder');
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to delete';
  }
}

// ── Leave guard ────────────────────────────────────────────────────
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!anyDirty.value) return;
  e.preventDefault();
  e.returnValue = '';
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));

// ── Deep link: ?tab=files&path=… ───────────────────────────────────
async function consumeQuery() {
  const wanted = typeof route.query.path === 'string' ? route.query.path : null;
  const proposalId = typeof route.query.proposal === 'string' ? route.query.proposal : null;
  const wantCompare = route.query.compare === '1' || route.query.compare === 'true';
  if (!wanted && !proposalId) return;
  if (proposalId) {
    await openProposal(proposalId, wantCompare);
  } else if (wanted && store.nodeFor(props.id, wanted)) {
    await openFile(wanted);
  }
  void router.replace({
    query: { ...route.query, path: undefined, proposal: undefined, compare: undefined },
  });
}

// Lazy so this sub-provider doesn't re-suspend the page once the parent's
// agent data resolves and this component mounts.
useAsyncData(
  `admin-agent-files-${props.id}`,
  async () => {
    await Promise.all([
      // Hint-only: a failed agent fetch must not break the file browser.
      agentStore.fetchById(props.id).catch(() => null),
      store.fetchLimits(props.id).catch(() => null),
      store.fetchList(props.id),
    ]);
    await consumeQuery();
    return true;
  },
  { lazy: true },
);

watch(
  () => [route.query.path, route.query.proposal],
  () => void consumeQuery(),
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <AgentFileImportDialog v-model:open="importOpen" :agent-id="id" @applied="onImported" />
    <AgentFileNewFileDialog
      v-model:open="newFileOpen"
      :agent-id="id"
      :folder="activeFolder"
      @created="onCreated"
    />

    <div
      v-if="pendingRestart"
      class="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
    >
      <IconAlertTriangle class="size-4 shrink-0" />
      <p class="flex-1 min-w-[14rem]">
        File changes are saved. Restart the agent so it picks up the new files.
      </p>
      <p v-if="restartError" class="w-full truncate text-destructive" :title="restartError">
        {{ restartError }}
      </p>
      <div class="flex items-center gap-2">
        <Button size="sm" :disabled="restarting" @click="onRestart">
          <IconRefresh class="size-4" :class="restarting && 'animate-spin'" />
          {{ restarting ? 'Restarting…' : 'Restart now' }}
        </Button>
        <Button variant="ghost" size="sm" :disabled="restarting" @click="dismissRestartBanner">
          Later
          <IconX class="size-4" />
        </Button>
      </div>
    </div>

    <!-- Header: title · path chip · count · actions -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
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
            <div class="h-[80vh] overflow-hidden pb-4">
              <AgentFileExplorer
                :files="nodes"
                :active="active"
                :selected="selection"
                :dirty="dirtyPaths"
                :busy="bulkBusy || downloading"
                @open="openFile"
                @update:selected="onSelectionChange"
                @delete="onDelete"
                @bulk-download="onBulkDownload"
                @bulk-delete="onBulkDelete"
              />
            </div>
          </SheetContent>
        </Sheet>
        <h3 class="hidden text-sm font-semibold md:block">Files</h3>
        <code
          class="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          :title="`agents/${id}/`"
        >
          agents/{{ id.slice(0, 14) }}…/
        </code>
        <p class="text-xs text-muted-foreground">
          {{ nodes.length }} files · {{ formatBytes(totalBytes) }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <button
          v-if="copyPill"
          type="button"
          class="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
          :title="copyPillTitle"
          :disabled="syncing"
          @click="onSync"
        >
          <span class="size-1.5 rounded-full bg-amber-500" />
          {{ copyPill }}
          <span class="font-medium">{{ syncing ? 'Syncing…' : 'Sync now' }}</span>
        </button>
        <slot name="actions" />
        <Button variant="outline" size="sm" @click="importOpen = true">
          <IconUpload class="size-4" />
          Import
        </Button>
        <Button size="sm" @click="newFileOpen = true">
          <IconPlus class="size-4" />
          New file
        </Button>
        <Button variant="outline" size="sm" :disabled="downloading" @click="onDownload()">
          <IconDownload class="size-4" />
          {{ downloading ? 'Downloading…' : 'Download' }}
        </Button>
        <Button v-if="!copyPill" variant="outline" size="sm" :disabled="syncing" @click="onSync">
          <IconRefresh class="size-4" :class="syncing && 'animate-spin'" />
          {{ syncing ? 'Syncing…' : 'Sync' }}
        </Button>
      </div>
    </div>

    <div v-if="actionError" class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      {{ actionError }}
    </div>
    <div v-if="syncError" class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      {{ syncError }}
    </div>
    <div v-else-if="syncMessage" class="rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {{ syncMessage }}
    </div>

    <div class="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)] md:items-start">
      <div class="hidden h-[680px] overflow-hidden rounded-md border md:block">
        <AgentFileExplorer
          :files="nodes"
          :active="active"
          :selected="selection"
          :dirty="dirtyPaths"
          :busy="bulkBusy || downloading"
          @open="openFile"
          @update:selected="onSelectionChange"
          @delete="onDelete"
          @bulk-download="onBulkDownload"
          @bulk-delete="onBulkDelete"
        />
      </div>

      <div class="flex min-h-[560px] flex-col overflow-hidden rounded-md border">
        <AgentFileTabs
          v-if="tabs.length"
          :tabs="tabs"
          :active="active"
          :dirty="dirtyMap"
          @activate="(p) => store.activate(id, p)"
          @close="closeTab"
        />

        <div
          v-if="activeMode === 'none'"
          class="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground"
        >
          Select a file to view
        </div>

        <!-- Binary / too large: no editor, only the facts and the two ways out -->
        <div
          v-else-if="activeMode === 'panel' && active"
          class="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center"
        >
          <IconFile class="size-8 text-muted-foreground" />
          <p class="font-mono text-sm">{{ active }}</p>
          <p class="text-xs text-muted-foreground">
            {{ formatBytes(activeLoaded?.totalSize || activeNode?.size || 0) }}
            <template v-if="activeNode?.updatedAt"> · modified {{ formatModified(activeNode.updatedAt) }}</template>
          </p>
          <p class="max-w-md text-xs text-muted-foreground">
            <template v-if="(activeLoaded?.kind ?? activeNode?.kind) === 'binary'">
              This is a binary file — it cannot be edited in place. Download it, or open the stored file in a new tab.
            </template>
            <template v-else-if="activeLoaded?.error">
              {{ activeLoaded.error }}
            </template>
            <template v-else>
              Too large to show here — download it, or open the stored file in a new tab.
            </template>
          </p>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="downloading" @click="onDownload([active])">
              <IconDownload class="size-4" />
              Download
            </Button>
            <Button size="sm" :disabled="opening" @click="onOpenFull(active)">
              <IconExternalLink class="size-4" />
              Open full
            </Button>
          </div>
        </div>

        <ClientOnly v-else-if="compare && active">
          <AgentFileDiffView
            :path="compare.path"
            :original="compare.original"
            :modified="compare.modified"
            :original-label="compare.originalLabel"
            :modified-label="compare.modifiedLabel"
            class="flex-1"
            @close="compare = null"
          />
        </ClientOnly>

        <template v-else-if="active">
          <p v-if="compareError" class="border-b bg-amber-500/10 px-3 py-1 text-xs text-amber-900 dark:text-amber-200">
            {{ compareError }}
          </p>
          <div class="flex items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground">
            <span class="truncate font-mono" :title="active">{{ active }}</span>
            <span class="ml-auto shrink-0">
              {{ formatBytes(activeLoaded?.totalSize || activeNode?.size || 0) }}
              <template v-if="activeNode?.updatedAt"> · Modified {{ formatModified(activeNode.updatedAt) }}</template>
            </span>
            <Button variant="ghost" size="sm" class="h-6 px-1.5" :disabled="opening" title="Open the stored file in a new tab" @click="onOpenFull(active)">
              <IconExternalLink class="size-3.5" />
              Open full
            </Button>
          </div>
          <ClientOnly>
            <AgentFileEditor
              :key="active"
              :agent-id="id"
              :path="active"
              :saving="saving"
              :save-error="saveError"
              :proposal-id="store.draftFor(id, active)?.proposalId ?? null"
              class="flex-1"
              @save="onSave"
              @discard="onDiscard"
              @compare="onCompare"
            />
            <template #fallback>
              <div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading editor…</div>
            </template>
          </ClientOnly>
        </template>
      </div>
    </div>
  </div>
</template>
