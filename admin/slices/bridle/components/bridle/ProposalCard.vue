<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button } from '#theme/components/ui/button'
import { FileText, RotateCw, ExternalLink } from 'lucide-vue-next'
import { useFileProposalStore, ProposalRemoveConfirmNeeded } from '#agentFile/stores/fileProposal'
import { useAgentFileStore } from '#agentFile/stores/agentFile'
import { parseUnifiedDiff } from '../../utils/diffLines'

/**
 * A file change proposal inside the chat (CLEAN-112, contracts/bridle-events.md).
 * Renders by id from the proposal store; the actions call the same API the
 * Files tab uses. Inline diff only when the API sent one (it is capped there).
 */
const props = defineProps<{ proposalId: string }>()

const emit = defineEmits<{
  /** After a successful Apply — the provider sends the follow-up message. */
  applied: [text: string]
}>()

const proposals = useFileProposalStore()
const files = useAgentFileStore()
const agents = useAgentStore()
const confirmStore = useConfirmStore()

const p = computed(() => proposals.get(props.proposalId))
const busy = computed(() => proposals.isBusy(props.proposalId))
const error = ref<string | null>(null)
const restarting = ref(false)
const restartDone = ref(false)

const rows = computed(() => (p.value?.inlineDiff ? parseUnifiedDiff(p.value.inlineDiff) : []))
const isSet = computed(() => p.value?.kind === 'set')
const counts = computed(() => p.value?.summary?.counts ?? null)
const removing = computed(() => (p.value?.summary?.mode === 'replace' ? counts.value?.remove ?? 0 : 0))

const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' })
const actedTime = computed(() => {
  const at = p.value?.actedAt ? Date.parse(p.value.actedAt) : NaN
  return Number.isFinite(at) ? timeFormat.format(at) : ''
})

const filesHref = computed(() => {
  if (!p.value) return '#'
  const q = p.value.path ? `&path=${encodeURIComponent(p.value.path)}` : ''
  return `/agents/${p.value.agentId}?tab=files${q}`
})
const editHref = computed(() => (p.value ? `/agents/${p.value.agentId}?tab=files&proposal=${p.value.id}` : '#'))
const compareHref = computed(() => (p.value ? `${editHref.value}&compare=1` : '#'))

const summaryLine = computed(() => {
  const v = p.value
  if (!v) return ''
  if (v.kind === 'set') {
    const c = counts.value
    return c
      ? `+${c.add} add · ~${c.change} change${v.summary?.mode === 'replace' ? ` · −${c.remove} remove` : ''} · ${c.skip} skipped`
      : ''
  }
  if (v.diffStatus === 'too_large') return 'too large to compare'
  if (v.diffStatus === 'binary') return 'binary file'
  return `+${v.additions ?? 0} −${v.deletions ?? 0}`
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

async function onApply() {
  const v = p.value
  if (!v || busy.value) return
  error.value = null
  let confirmRemove = false
  if (removing.value > 0) {
    const ok = await confirmStore.ask({
      title: `Replace the workspace and remove ${removing.value} file${removing.value === 1 ? '' : 's'}?`,
      description:
        'Replace makes the workspace identical to the archive: every file that is not in it is deleted. This cannot be undone.',
      confirmLabel: `Remove ${removing.value} and import`,
      cancelLabel: 'Cancel',
      variant: 'destructive',
    })
    if (!ok) return
    confirmRemove = true
  }
  try {
    const row = await proposals.apply(v.agentId, v.id, 'card', { confirmRemove })
    if (row.status === 'applied') {
      emit(
        'applied',
        v.kind === 'set'
          ? `Applied import into ${v.agentName}`
          : `Applied change to ${v.path}`,
      )
    }
  } catch (err) {
    if (err instanceof ProposalRemoveConfirmNeeded) {
      error.value = `Replace would remove ${err.remove} files — press Apply again to acknowledge.`
    } else {
      error.value = (err as Error).message || 'Apply failed'
    }
  }
}

async function onSkip() {
  const v = p.value
  if (!v || busy.value) return
  error.value = null
  try {
    await proposals.skip(v.agentId, v.id)
  } catch (err) {
    error.value = (err as Error).message || 'Skip failed'
  }
}

async function onRestart() {
  const v = p.value
  if (!v) return
  restarting.value = true
  error.value = null
  try {
    await agents.restart(v.agentId)
    files.clearPendingRestart(v.agentId)
    restartDone.value = true
  } catch (err) {
    error.value = (err as Error).message || 'Restart failed'
  } finally {
    restarting.value = false
  }
}

function onLater() {
  if (p.value) files.markPendingRestart(p.value.agentId)
  restartDone.value = true
}
</script>

<template>
  <div
    v-if="p"
    :data-proposal-id="p.id"
    :data-proposal-status="p.status"
    class="w-full min-w-[18rem] max-w-xl overflow-hidden rounded-md border bg-background text-xs text-foreground"
  >
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <FileText class="h-3.5 w-3.5 shrink-0" />
      <template v-if="isSet">
        <span class="font-medium">Import into {{ p.agentName }}</span>
        <span class="text-muted-foreground">· {{ p.summary?.mode ?? 'merge' }}</span>
      </template>
      <template v-else>
        <span class="truncate font-mono font-medium" :title="p.path ?? ''">{{ p.path }}</span>
        <span v-if="p.firstChangedLine" class="text-muted-foreground">· line {{ p.firstChangedLine }}</span>
      </template>
      <span class="ml-auto whitespace-nowrap text-muted-foreground">{{ summaryLine }}</span>
      <a
        :href="filesHref"
        class="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
        title="Open the Files tab"
      >Open in Files</a>
    </div>

    <!-- Body: inline diff / summary / set rows -->
    <div v-if="!isSet && rows.length" class="max-h-64 overflow-auto font-mono text-[11px] leading-5">
      <div
        v-for="(row, i) in rows"
        :key="i"
        :class="[
          'flex gap-2 px-2 whitespace-pre',
          row.kind === 'add' && 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
          row.kind === 'remove' && 'bg-destructive/15 text-destructive',
          row.kind === 'hunk' && 'bg-muted/60 text-muted-foreground',
        ]"
      >
        <span class="w-8 shrink-0 select-none text-right text-muted-foreground">{{ row.line ?? '' }}</span>
        <span class="w-3 shrink-0 select-none">{{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : '' }}</span>
        <span class="min-w-0 flex-1 overflow-x-auto">{{ row.kind === 'hunk' ? row.text : row.text }}</span>
      </div>
    </div>
    <div v-else-if="!isSet" class="flex flex-wrap items-center gap-2 px-3 py-2 text-muted-foreground">
      <span v-if="p.diffStatus === 'too_large'">Too large to compare inline ({{ formatBytes(p.proposedBytes) }}).</span>
      <span v-else-if="p.diffStatus === 'binary'">Binary file — {{ formatBytes(p.proposedBytes) }}; Apply replaces it.</span>
      <span v-else-if="(p.changedLines ?? 0) === 0">No textual change ({{ formatBytes(p.proposedBytes) }}).</span>
      <span v-else>Large change: {{ summaryLine }} over {{ p.changedLines }} lines ({{ formatBytes(p.proposedBytes) }}).</span>
      <a
        v-if="p.diffStatus === 'ok' && (p.changedLines ?? 0) > 0"
        :href="compareHref"
        class="rounded border px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent"
      >View diff in Files</a>
    </div>
    <div v-else class="px-3 py-2">
      <p v-if="p.summary?.wrapperStripped" class="mb-1 text-muted-foreground">
        Archive root folder <code>{{ p.summary.wrapperStripped }}/</code> stripped.
      </p>
      <p v-for="w in p.summary?.warnings ?? []" :key="w" class="mb-1 text-amber-700 dark:text-amber-300">{{ w }}</p>
      <div class="max-h-56 overflow-auto font-mono text-[11px] leading-5">
        <div v-for="row in p.summary?.rows ?? []" :key="row.path" class="flex gap-2">
          <span
            :class="[
              'w-16 shrink-0 rounded px-1 text-center',
              row.action === 'add' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
              row.action === 'change' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
              row.action === 'remove' && 'bg-destructive/15 text-destructive',
              row.action === 'skip' && 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
            ]"
          >{{ row.action }}</span>
          <span class="truncate" :title="row.path">{{ row.path }}</span>
          <span class="ml-auto shrink-0 text-muted-foreground">{{ formatBytes(row.size) }}</span>
        </div>
        <p v-if="(p.summary?.more ?? 0) > 0" class="text-muted-foreground">and {{ p.summary?.more }} more</p>
      </div>
    </div>

    <!-- Footer: actions or final state -->
    <div class="flex flex-wrap items-center gap-2 border-t px-3 py-2">
      <template v-if="p.status === 'pending'">
        <Button size="sm" class="h-7" :disabled="busy" :variant="removing > 0 ? 'destructive' : 'default'" @click="onApply">
          <RotateCw v-if="busy" class="h-3.5 w-3.5 animate-spin" />
          Apply
        </Button>
        <Button v-if="!isSet" as="a" :href="editHref" variant="outline" size="sm" class="h-7" :disabled="busy">
          Edit before applying
        </Button>
        <Button variant="ghost" size="sm" class="h-7" :disabled="busy" @click="onSkip">Skip</Button>
        <span class="ml-auto text-muted-foreground">applies on next restart</span>
      </template>
      <template v-else-if="p.status === 'applied'">
        <span class="text-emerald-700 dark:text-emerald-300">✓ Applied<template v-if="actedTime"> · {{ actedTime }}</template><template v-if="p.actedVia === 'editor'"> · from the editor</template></span>
        <template v-if="p.restartRequired && !restartDone">
          <span class="text-muted-foreground">· applies on next restart</span>
          <Button size="sm" class="ml-auto h-7" :disabled="restarting" @click="onRestart">
            <RotateCw class="h-3.5 w-3.5" :class="restarting && 'animate-spin'" />
            Restart now
          </Button>
          <Button variant="outline" size="sm" class="h-7" :disabled="restarting" @click="onLater">Later</Button>
        </template>
      </template>
      <span v-else-if="p.status === 'skipped'" class="text-muted-foreground">Skipped<template v-if="actedTime"> · {{ actedTime }}</template></span>
      <span v-else-if="p.status === 'stale'" class="text-amber-700 dark:text-amber-300">
        File changed since this was proposed — ask the agent to propose again.
      </span>
      <span v-else class="text-destructive">Refused<template v-if="p.reason">: {{ p.reason }}</template></span>
      <a
        v-if="p.status !== 'pending' && !isSet"
        :href="filesHref"
        class="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      ><ExternalLink class="h-3 w-3" /> Files</a>
    </div>
    <p v-if="error" class="border-t px-3 py-1.5 text-destructive">{{ error }}</p>
  </div>
  <div v-else class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
    Loading proposal…
  </div>
</template>
