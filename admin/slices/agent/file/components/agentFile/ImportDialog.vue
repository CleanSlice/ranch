<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { Button } from '#theme/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '#theme/components/ui/tabs';
import { IconAlertTriangle, IconRefresh, IconUpload } from '@tabler/icons-vue';
import { useAgentFileStore } from '#agentFile/stores/agentFile';
import type {
  IImportPlan,
  IImportResult,
  ImportAction,
  ImportDialogMode,
  ImportMode,
} from '#agentFile/domain';
import { formatBytes } from '#agentFile/utils/format';
import {
  addAsNewPath,
  allSettled,
  confirmable,
  duplicateName,
  isLoneZip,
  overLimits,
  rowLabel,
  toTargetRows,
  toTargets,
  type ITargetRow,
} from '#agentFile/utils/importTargets';

/**
 * Import (CLEAN-112 archive flow, CLEAN-192 mode switch + selected files).
 *
 * Whole workspace: pick → upload once → plan → choose Merge/Replace →
 * confirm (twice for removals) → result → restart hint.
 *
 * Selected files: pick → resolve names (no upload) → settle targets →
 * upload → plan (merge only, "replace" rows) → confirm → the same result.
 *
 * Nothing is written before the operator confirms the plan, in either mode.
 */
const props = defineProps<{ open: boolean; agentId: string; folder?: string | null }>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'applied', result: IImportResult): void;
}>();

const store = useAgentFileStore();
const agentStore = useAgentStore();
const confirmStore = useConfirmStore();

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
});

type Step =
  | 'pick'
  | 'zipChoice'
  | 'resolving'
  | 'targets'
  | 'uploading'
  | 'plan'
  | 'applying'
  | 'result';
const step = ref<Step>('pick');
const error = ref<string | null>(null);
const progress = ref(0);
const file = ref<File | null>(null);
const plan = ref<IImportPlan | null>(null);
const mode = ref<ImportMode>('merge');
const includeSessions = ref(false);
const replanning = ref(false);
const result = ref<IImportResult | null>(null);
const restarting = ref(false);
const dragOver = ref(false);

// Selected files (CLEAN-192)
const files = ref<File[]>([]);
const targetRows = ref<ITargetRow[]>([]);
const targetFolder = ref('');

const limits = computed(() => store.limits);
const dialogMode = computed<ImportDialogMode>(() => store.importMode);
const filesMode = computed(() => dialogMode.value === 'files');
const canSwitch = computed(() => step.value === 'pick');

const actionLabel = computed<Record<ImportAction, string>>(() => ({
  add: 'add',
  change: filesMode.value ? 'replace' : 'change',
  unchanged: 'unchanged',
  remove: 'remove',
  skip: 'skip',
}));
const actionClass: Record<ImportAction, string> = {
  add: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  change: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  unchanged: 'bg-muted text-muted-foreground',
  remove: 'bg-destructive/15 text-destructive',
  skip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

const visibleEntries = computed(() =>
  (plan.value?.entries ?? []).filter((e) => e.action !== 'unchanged'),
);
const hiddenUnchanged = computed(
  () => (plan.value?.entries ?? []).length - visibleEntries.value.length,
);
const targetsSettled = computed(() => allSettled(targetRows.value));
const canConfirm = computed(
  () =>
    !!plan.value &&
    !replanning.value &&
    (filesMode.value
      ? confirmable(plan.value)
      : plan.value.counts.add +
          plan.value.counts.change +
          (mode.value === 'replace' ? plan.value.counts.remove : 0) >
        0),
);

function reset() {
  step.value = 'pick';
  error.value = null;
  progress.value = 0;
  file.value = null;
  plan.value = null;
  mode.value = 'merge';
  includeSessions.value = false;
  result.value = null;
  files.value = [];
  targetRows.value = [];
  targetFolder.value = (props.folder ?? '').replace(/\/$/, '');
}

watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
);

function onModeChange(v: string | number | undefined) {
  if (!canSwitch.value) return;
  if (v !== 'workspace' && v !== 'files') return;
  store.setImportMode(v);
  error.value = null;
  file.value = null;
  files.value = [];
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const list = Array.from(input.files ?? []);
  input.value = '';
  if (list.length) void take(list);
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  const items = Array.from(e.dataTransfer?.items ?? []);
  const folder = items.find((it) => {
    const entry = (
      it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }
    ).webkitGetAsEntry?.();
    return entry?.isDirectory === true;
  });
  if (folder) {
    error.value = filesMode.value
      ? 'Folders cannot be dropped here — zip the folder and use Whole workspace.'
      : 'Zip the folder first: Whole workspace takes one .zip with the workspace layout.';
    return;
  }
  const list = Array.from(e.dataTransfer?.files ?? []);
  if (list.length) void take(list);
}

async function take(list: File[]) {
  error.value = null;
  if (filesMode.value) {
    await takeFiles(list);
    return;
  }
  if (list.length !== 1 || !/\.zip$/i.test(list[0].name)) {
    error.value =
      'Pick one .zip with the workspace layout (root files, data/, memory/, skills/, workspace/), or switch to Selected files for plain files.';
    return;
  }
  await stage(list[0]);
}

// ── Whole workspace (CLEAN-112) ─────────────────────────────────

async function stage(f: File) {
  error.value = null;
  const max = limits.value?.importMaxArchiveBytes ?? 0;
  if (max && f.size > max) {
    error.value = `${f.name} is ${formatBytes(f.size)} — the limit is ${formatBytes(max)}.`;
    return;
  }
  file.value = f;
  step.value = 'uploading';
  progress.value = 0;
  try {
    plan.value = await store.stageImport(props.agentId, f, (p) => (progress.value = p));
    mode.value = plan.value.mode;
    includeSessions.value = plan.value.includeSessions;
    step.value = 'plan';
  } catch (err) {
    error.value = (err as Error).message || 'The archive was refused';
    step.value = 'pick';
  }
}

async function replan() {
  if (!plan.value) return;
  replanning.value = true;
  error.value = null;
  try {
    plan.value = await store.planImport(
      props.agentId,
      plan.value.importId,
      mode.value,
      includeSessions.value,
    );
  } catch (err) {
    error.value = (err as Error).message || 'Could not update the preview';
  } finally {
    replanning.value = false;
  }
}

watch([mode, includeSessions], () => {
  if (step.value === 'plan' && !filesMode.value) void replan();
});

// ── Selected files (CLEAN-192) ──────────────────────────────────

async function takeFiles(list: File[]) {
  const dup = duplicateName(list);
  if (dup) {
    error.value = `Two files are named ${dup} — drop them in two rounds.`;
    return;
  }
  const breach = overLimits(list, limits.value, formatBytes);
  if (breach) {
    error.value = breach;
    return;
  }
  files.value = list;
  if (isLoneZip(list)) {
    // Not unpacked silently: the operator says what they meant.
    step.value = 'zipChoice';
    return;
  }
  await resolveFiles();
}

async function switchToWorkspace() {
  const zip = files.value[0];
  files.value = [];
  store.setImportMode('workspace');
  step.value = 'pick';
  if (zip) await stage(zip);
}

async function keepZipAsFile() {
  await resolveFiles();
}

async function resolveFiles() {
  step.value = 'resolving';
  error.value = null;
  try {
    const res = await store.resolveImportFiles(
      props.agentId,
      files.value.map((f) => f.name),
      targetFolder.value,
    );
    targetFolder.value = res.targetFolder;
    targetRows.value = toTargetRows(res.rows);
    step.value = 'targets';
  } catch (err) {
    error.value = (err as Error).message || 'Could not match the files against the workspace';
    files.value = [];
    step.value = 'pick';
  }
}

async function preview() {
  if (!targetsSettled.value) return;
  step.value = 'uploading';
  progress.value = 0;
  error.value = null;
  try {
    plan.value = await store.stageImportFiles(
      props.agentId,
      files.value,
      toTargets(targetRows.value),
      targetFolder.value,
      (p) => (progress.value = p),
    );
    mode.value = 'merge';
    includeSessions.value = false;
    step.value = 'plan';
  } catch (err) {
    error.value = (err as Error).message || 'The files were refused';
    step.value = 'targets';
  }
}

function sizeOf(row: ITargetRow): number {
  return files.value.find((f) => f.name === row.name)?.size ?? 0;
}

// ── Confirm, result, restart (shared) ───────────────────────────

async function apply() {
  if (!plan.value) return;
  const removing = !filesMode.value && mode.value === 'replace' ? plan.value.counts.remove : 0;
  if (removing > 0) {
    const ok = await confirmStore.ask({
      title: `Replace the workspace and remove ${removing} file${removing === 1 ? '' : 's'}?`,
      description:
        'Replace makes the workspace identical to the archive: every file that is not in the archive is deleted from S3. This cannot be undone — Download the workspace first if you are unsure.',
      confirmLabel: `Remove ${removing} and import`,
      cancelLabel: 'Cancel',
      variant: 'destructive',
    });
    if (!ok) return;
  }
  step.value = 'applying';
  error.value = null;
  try {
    const outcome = await store.applyImport(props.agentId, plan.value.importId, {
      mode: filesMode.value ? 'merge' : mode.value,
      includeSessions: filesMode.value ? false : includeSessions.value,
      confirmRemove: removing > 0,
    });
    if (outcome.status === 'conflict') {
      // The plan moved between preview and apply — show the fresh count.
      error.value = `Replace would remove ${outcome.remove} files — review the plan and confirm again.`;
      await replan();
      step.value = 'plan';
      return;
    }
    result.value = outcome.result;
    step.value = 'result';
    emit('applied', outcome.result);
  } catch (err) {
    error.value = (err as Error).message || 'Import failed';
    step.value = 'plan';
  }
}

async function restartNow() {
  restarting.value = true;
  try {
    await agentStore.restart(props.agentId);
    store.clearPendingRestart(props.agentId);
    isOpen.value = false;
  } catch (err) {
    error.value = (err as Error).message || 'Restart failed';
  } finally {
    restarting.value = false;
  }
}

function later() {
  isOpen.value = false;
}
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/80" />
      <DialogContent
        class="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border bg-background p-6 shadow-lg"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-lg font-semibold">Import</DialogTitle>
          <DialogDescription class="text-sm text-muted-foreground">
            <template v-if="filesMode">
              A few plain files, each matched by name: an existing file with that name is replaced,
              a new name is added to <code>{{ targetFolder || 'the root' }}</code>. You will see what
              changes before anything is written.
            </template>
            <template v-else>
              A zip with the workspace layout: root files plus <code>data/</code>, <code>memory/</code>,
              <code>skills/</code>, <code>workspace/</code>. You will see what changes before anything is written.
            </template>
          </DialogDescription>
        </div>

        <Tabs :model-value="dialogMode" @update:model-value="onModeChange">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="workspace" :disabled="!canSwitch">Whole workspace</TabsTrigger>
            <TabsTrigger value="files" :disabled="!canSwitch">Selected files</TabsTrigger>
          </TabsList>
        </Tabs>

        <div
          v-if="error"
          class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <IconAlertTriangle class="mt-0.5 size-4 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <!-- pick -->
        <label
          v-if="step === 'pick'"
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground hover:bg-accent/40"
          :class="dragOver && 'bg-accent/60'"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <IconUpload class="size-6" />
          <template v-if="filesMode">
            <span>Drop files here or click to choose</span>
            <span v-if="limits" class="text-xs">
              Up to {{ limits.importMaxFiles }} files, {{ formatBytes(limits.importMaxFileBytes) }} each
            </span>
            <input type="file" multiple class="hidden" @change="onPick" />
          </template>
          <template v-else>
            <span>Drop a .zip here or click to choose</span>
            <span v-if="limits" class="text-xs">
              Up to {{ formatBytes(limits.importMaxArchiveBytes) }}, {{ limits.importMaxEntries }} files,
              {{ formatBytes(limits.importMaxFileBytes) }} per file
            </span>
            <input type="file" accept=".zip,application/zip" class="hidden" @change="onPick" />
          </template>
        </label>

        <!-- a lone zip in files mode: ask, never unpack silently -->
        <div v-else-if="step === 'zipChoice'" class="flex flex-col gap-3 py-4 text-sm">
          <p>
            <b>{{ files[0]?.name }}</b> is a zip. Import it as a whole workspace, or keep it as one file
            named <code>{{ addAsNewPath(targetFolder, files[0]?.name ?? '') }}</code>?
          </p>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" @click="switchToWorkspace">Switch to Whole workspace</Button>
            <Button size="sm" variant="outline" @click="keepZipAsFile">Keep as a file</Button>
          </div>
        </div>

        <!-- resolving -->
        <div v-else-if="step === 'resolving'" class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <IconRefresh class="size-4 animate-spin" />
          Matching {{ files.length }} file{{ files.length === 1 ? '' : 's' }} against the workspace…
        </div>

        <!-- targets -->
        <div v-else-if="step === 'targets'" class="flex min-h-0 flex-1 flex-col gap-3 text-sm">
          <p class="text-xs text-muted-foreground">
            Where each file will go. A name that exists in several places needs your choice.
          </p>
          <div class="min-h-0 flex-1 overflow-auto rounded-md border text-xs">
            <table class="w-full">
              <tbody>
                <tr v-for="row in targetRows" :key="row.name" class="border-b last:border-0">
                  <td class="truncate px-2 py-1 font-mono" :title="row.name">{{ row.name }}</td>
                  <td class="px-2 py-1">
                    <select
                      v-if="row.match === 'ambiguous'"
                      v-model="row.chosen"
                      class="w-full rounded-md border bg-background px-2 py-1"
                    >
                      <option :value="null" disabled>choose…</option>
                      <option v-for="c in row.candidates" :key="c" :value="c">replaces {{ c }}</option>
                      <option :value="addAsNewPath(targetFolder, row.name)">
                        add as new in {{ targetFolder || 'root' }}
                      </option>
                    </select>
                    <span v-else :class="row.match === 'unique' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'">
                      {{ rowLabel(row, targetFolder) }}
                    </span>
                  </td>
                  <td class="w-20 px-2 py-1 text-right text-muted-foreground">{{ formatBytes(sizeOf(row)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- uploading -->
        <div v-else-if="step === 'uploading'" class="flex flex-col gap-2 py-6 text-sm">
          <p v-if="filesMode" class="truncate">
            Uploading {{ files.length }} file{{ files.length === 1 ? '' : 's' }}
            ({{ formatBytes(files.reduce((n, f) => n + f.size, 0)) }})…
          </p>
          <p v-else class="truncate">Uploading {{ file?.name }} ({{ formatBytes(file?.size ?? 0) }})…</p>
          <div class="h-2 overflow-hidden rounded bg-muted">
            <div class="h-full bg-primary transition-all" :style="{ width: `${progress}%` }" />
          </div>
          <p class="text-xs text-muted-foreground">
            {{ progress < 100 ? `${progress}%` : filesMode ? 'Comparing with the workspace…' : 'Checking the archive and comparing with the workspace…' }}
          </p>
        </div>

        <!-- plan -->
        <div v-else-if="step === 'plan' || step === 'applying'" class="flex min-h-0 flex-1 flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">+{{ plan?.counts.add }} add</span>
            <span class="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">~{{ plan?.counts.change }} {{ actionLabel.change }}</span>
            <span v-if="!filesMode && mode === 'replace'" class="rounded-md bg-destructive/15 px-2 py-0.5 text-destructive">−{{ plan?.counts.remove }} remove</span>
            <span v-if="!filesMode" class="rounded-md bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-300">{{ plan?.counts.skip }} skip</span>
            <span class="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{{ plan?.counts.unchanged }} unchanged</span>
            <span class="ml-auto text-muted-foreground">{{ formatBytes(plan?.totalBytes ?? 0) }} to write</span>
          </div>

          <p v-if="plan?.wrapperStripped" class="text-xs text-muted-foreground">
            The archive wraps everything in <code>{{ plan.wrapperStripped }}/</code> — treated as the workspace root.
          </p>
          <p v-for="w in plan?.warnings ?? []" :key="w" class="text-xs text-amber-700 dark:text-amber-300">
            {{ w }}
          </p>

          <div v-if="!filesMode" class="flex flex-wrap items-center gap-4 text-xs">
            <label class="flex items-center gap-1.5">
              <input v-model="mode" type="radio" value="merge" :disabled="replanning || step === 'applying'" />
              <span><b>Merge</b> — add and overwrite, keep everything else</span>
            </label>
            <label class="flex items-center gap-1.5">
              <input v-model="mode" type="radio" value="replace" :disabled="replanning || step === 'applying'" />
              <span><b>Replace</b> — make the workspace identical to the archive</span>
            </label>
            <label class="flex items-center gap-1.5">
              <input v-model="includeSessions" type="checkbox" :disabled="replanning || step === 'applying'" />
              <span>include <code>sessions/</code> (runtime state)</span>
            </label>
          </div>
          <p v-else class="text-xs text-muted-foreground">
            Selected files only add or replace — nothing is removed.
          </p>

          <div class="min-h-0 flex-1 overflow-auto rounded-md border text-xs">
            <table class="w-full">
              <tbody>
                <tr v-for="e in visibleEntries" :key="e.path" class="border-b last:border-0">
                  <td class="w-20 px-2 py-1">
                    <span class="rounded px-1.5 py-0.5" :class="actionClass[e.action]">{{ actionLabel[e.action] }}</span>
                  </td>
                  <td class="truncate px-2 py-1 font-mono" :title="e.reason ?? e.path">{{ e.path }}</td>
                  <td class="w-20 px-2 py-1 text-right text-muted-foreground">{{ formatBytes(e.size) }}</td>
                </tr>
                <tr v-if="!visibleEntries.length">
                  <td colspan="3" class="px-2 py-4 text-center text-muted-foreground">
                    {{ filesMode ? 'Nothing to write — every selected file is already identical.' : 'Nothing to write — every file in the archive is already identical.' }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="hiddenUnchanged > 0 || (plan?.more ?? 0) > 0" class="px-2 py-1 text-muted-foreground">
              <template v-if="hiddenUnchanged > 0">{{ hiddenUnchanged }} unchanged not shown</template>
              <template v-if="hiddenUnchanged > 0 && (plan?.more ?? 0) > 0"> · </template>
              <template v-if="(plan?.more ?? 0) > 0">and {{ plan?.more }} more entries</template>
            </p>
          </div>
        </div>

        <!-- result -->
        <div v-else-if="step === 'result' && result" class="flex flex-col gap-3 text-sm">
          <p>
            Imported: <b>{{ result.written }}</b> written<template v-if="result.removed">, <b>{{ result.removed }}</b> removed</template><template v-if="result.skipped">, {{ result.skipped }} skipped</template>.
          </p>
          <div v-if="result.failed.length" class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <p class="mb-1 font-medium">{{ result.failed.length }} file{{ result.failed.length === 1 ? '' : 's' }} could not be written — run the import again to finish:</p>
            <p v-for="f in result.failed.slice(0, 20)" :key="f.path" class="truncate font-mono">{{ f.path }} — {{ f.reason }}</p>
          </div>
          <p v-if="result.restartRequired" class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            The agent is running on its previous files — the import applies on the next restart.
          </p>
        </div>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <template v-if="step === 'targets'">
            <Button variant="outline" @click="isOpen = false">Cancel</Button>
            <Button :disabled="!targetsSettled" @click="preview">Preview</Button>
          </template>
          <template v-else-if="step === 'plan' || step === 'applying'">
            <Button variant="outline" :disabled="step === 'applying'" @click="isOpen = false">Cancel</Button>
            <Button
              :variant="!filesMode && mode === 'replace' && (plan?.counts.remove ?? 0) > 0 ? 'destructive' : 'default'"
              :disabled="step === 'applying' || !canConfirm"
              @click="apply"
            >
              <IconRefresh v-if="step === 'applying'" class="size-4 animate-spin" />
              {{ step === 'applying' ? 'Importing…' : !filesMode && mode === 'replace' ? 'Replace workspace' : 'Import' }}
            </Button>
          </template>
          <template v-else-if="step === 'result' && result?.restartRequired">
            <Button variant="outline" :disabled="restarting" @click="later">Later</Button>
            <Button :disabled="restarting" @click="restartNow">
              <IconRefresh class="size-4" :class="restarting && 'animate-spin'" />
              {{ restarting ? 'Restarting…' : 'Restart now' }}
            </Button>
          </template>
          <template v-else-if="step === 'result'">
            <Button @click="isOpen = false">Done</Button>
          </template>
          <template v-else>
            <Button variant="outline" :disabled="step === 'uploading' || step === 'resolving'" @click="isOpen = false">Cancel</Button>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
