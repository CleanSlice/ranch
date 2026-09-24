<script setup lang="ts">
import type { IBridleProposalSnapshot } from '#bridle/domain';

/**
 * A file change proposal in the app chat (CLEAN-112) — read-only twin of the
 * admin card: the write tools are operator-only and this console has no
 * Files tab, so there is nothing to act on here. Copy goes through `$t`.
 */
const props = defineProps<{ proposal: IBridleProposalSnapshot }>();

const { locale } = useI18n();

type Row = { kind: 'hunk' | 'context' | 'add' | 'remove'; line: number | null; text: string };
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Unified diff → rows; only what a bounded inline diff needs. */
function parse(patch: string): Row[] {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    const m = HUNK.exec(raw);
    if (m) {
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      inHunk = true;
      rows.push({ kind: 'hunk', line: null, text: raw });
      continue;
    }
    if (!inHunk || raw.startsWith('\\')) continue;
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === '+') {
      rows.push({ kind: 'add', line: newLine, text });
      newLine++;
    } else if (mark === '-') {
      rows.push({ kind: 'remove', line: oldLine, text });
      oldLine++;
    } else if (mark === ' ') {
      rows.push({ kind: 'context', line: newLine, text });
      oldLine++;
      newLine++;
    }
  }
  return rows;
}

const rows = computed(() => (props.proposal.inlineDiff ? parse(props.proposal.inlineDiff) : []));
const isSet = computed(() => props.proposal.kind === 'set');
const counts = computed(() => props.proposal.counts);

const actedTime = computed(() => {
  const at = props.proposal.actedAt ? Date.parse(props.proposal.actedAt) : NaN;
  return Number.isFinite(at)
    ? new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(at)
    : '';
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <div
    :data-proposal-id="proposal.id"
    :data-proposal-status="proposal.status"
    class="w-full min-w-[16rem] max-w-xl overflow-hidden rounded-md border bg-background text-xs text-foreground"
  >
    <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <template v-if="isSet">
        <span class="font-medium">{{ $t('proposal.import_into', { name: proposal.agentName }) }}</span>
        <span class="text-muted-foreground">· {{ proposal.mode ?? 'merge' }}</span>
      </template>
      <template v-else>
        <span class="truncate font-mono font-medium" :title="proposal.path ?? ''">{{ proposal.path }}</span>
        <span v-if="proposal.firstChangedLine" class="text-muted-foreground">
          · {{ $t('proposal.line', { n: proposal.firstChangedLine }) }}
        </span>
      </template>
      <span class="ml-auto whitespace-nowrap text-muted-foreground">
        <template v-if="isSet && counts">
          +{{ counts.add }} · ~{{ counts.change }}<template v-if="proposal.mode === 'replace'"> · −{{ counts.remove }}</template>
        </template>
        <template v-else-if="proposal.diffStatus === 'too_large'">{{ $t('proposal.too_large') }}</template>
        <template v-else-if="proposal.diffStatus === 'binary'">{{ $t('proposal.binary') }}</template>
        <template v-else>+{{ proposal.additions ?? 0 }} −{{ proposal.deletions ?? 0 }}</template>
      </span>
    </div>

    <div v-if="!isSet && rows.length" class="max-h-64 overflow-auto font-mono text-[11px] leading-5">
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="flex gap-2 whitespace-pre px-2"
        :class="[
          row.kind === 'add' && 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
          row.kind === 'remove' && 'bg-destructive/15 text-destructive',
          row.kind === 'hunk' && 'bg-muted/60 text-muted-foreground',
        ]"
      >
        <span class="w-8 shrink-0 select-none text-right text-muted-foreground">{{ row.line ?? '' }}</span>
        <span class="w-3 shrink-0 select-none">{{ row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : '' }}</span>
        <span class="min-w-0 flex-1 overflow-x-auto">{{ row.text }}</span>
      </div>
    </div>
    <div v-else-if="!isSet" class="px-3 py-2 text-muted-foreground">
      <template v-if="proposal.diffStatus === 'too_large'">
        {{ $t('proposal.too_large_body', { size: formatBytes(proposal.proposedBytes) }) }}
      </template>
      <template v-else-if="proposal.diffStatus === 'binary'">
        {{ $t('proposal.binary_body', { size: formatBytes(proposal.proposedBytes) }) }}
      </template>
      <template v-else>
        {{ $t('proposal.large_change', { lines: proposal.changedLines ?? 0, size: formatBytes(proposal.proposedBytes) }) }}
      </template>
    </div>
    <div v-else class="px-3 py-2">
      <div class="max-h-56 overflow-auto font-mono text-[11px] leading-5">
        <div v-for="row in proposal.rows" :key="row.path" class="flex gap-2">
          <span
            class="w-16 shrink-0 rounded px-1 text-center"
            :class="[
              row.action === 'add' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
              row.action === 'change' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
              row.action === 'remove' && 'bg-destructive/15 text-destructive',
              row.action === 'skip' && 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
            ]"
          >{{ row.action }}</span>
          <span class="truncate" :title="row.path">{{ row.path }}</span>
          <span class="ml-auto shrink-0 text-muted-foreground">{{ formatBytes(row.size) }}</span>
        </div>
        <p v-if="proposal.more > 0" class="text-muted-foreground">{{ $t('proposal.more', { n: proposal.more }) }}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-muted-foreground">
      <span v-if="proposal.status === 'pending'">{{ $t('proposal.pending') }}</span>
      <span v-else-if="proposal.status === 'applied'" class="text-emerald-700 dark:text-emerald-300">
        ✓ {{ $t('proposal.applied') }}<template v-if="actedTime"> · {{ actedTime }}</template>
        <template v-if="proposal.restartRequired"> · {{ $t('proposal.restart_hint') }}</template>
      </span>
      <span v-else-if="proposal.status === 'skipped'">{{ $t('proposal.skipped') }}<template v-if="actedTime"> · {{ actedTime }}</template></span>
      <span v-else-if="proposal.status === 'stale'" class="text-amber-700 dark:text-amber-300">{{ $t('proposal.stale') }}</span>
      <span v-else class="text-destructive">{{ $t('proposal.refused') }}<template v-if="proposal.reason">: {{ proposal.reason }}</template></span>
    </div>
  </div>
</template>
