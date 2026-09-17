<script setup lang="ts">
import { usePeerStore, type IAgentDelegation } from '#peer/stores/peer';

/**
 * The delegation feed (CLEAN-74, FR-016): who this agent asked, why, how long
 * it took and how it ended — readable without opening a chat.
 *
 * Live by design: the list re-reads itself every few seconds while the tab is
 * visible, so a delegation started in a chat appears here as it happens. The
 * value is in the failures — three "peer not running" rows in a row are the
 * reason someone opens this panel.
 */
const props = defineProps<{
  agentId: string;
  /** Narrow the feed to one peer; owned by Tab.vue (the tree sets it). */
  peerFilter?: { id: string; name: string } | null;
}>();

const emit = defineEmits<{
  'update:peerFilter': [value: { id: string; name: string } | null];
}>();

const store = usePeerStore();

const POLL_MS = 5000;
/** How long a fresh row keeps its entrance animation class. */
const FRESH_MS = 700;

const OUTCOME_FILTERS = ['all', 'answered', 'failed'] as const;
type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

/** Codes, rendered as the sentence an operator would say. */
const CAUSES: Record<string, string> = {
  PEER_NOT_RUNNING: 'peer not running',
  PEER_TIMEOUT: 'timed out',
  PEER_REJECTED_LOOP: 'refused: would loop',
  PEER_REJECTED_DEPTH: 'refused: chain too deep',
  PEER_UNAUTHORIZED: 'credential refused',
  PEER_UNREACHABLE: 'could not be reached',
  PEER_ERROR: 'error',
  // CLEAN-97: nothing was sent, so the peer did not fail — the card did.
  PEER_ADDRESS_REFUSED: 'refused: private address',
  PEER_UNSUPPORTED: 'no JSON-RPC interface',
};

const live = ref(true);
const outcomeFilter = ref<OutcomeFilter>('all');
const expandedId = ref<string | null>(null);
const freshIds = ref<Set<string>>(new Set());

const rows = computed(() => store.delegations(props.agentId));

const shown = computed(() =>
  rows.value.filter(
    (d) =>
      // The connection id works for both origins — external peers have no
      // agent id in this installation (CLEAN-95).
      (!props.peerFilter || d.peerId === props.peerFilter.id) &&
      (outcomeFilter.value === 'all' ||
        (outcomeFilter.value === 'answered'
          ? d.status === 'answered'
          : d.status === 'failed' || d.status === 'rejected')),
  ),
);

const maxTookMs = computed(() =>
  Math.max(...shown.value.map((d) => d.durationMs ?? 0), 1),
);

let pollTimer: ReturnType<typeof setInterval> | undefined;
let freshTimer: ReturnType<typeof setTimeout> | undefined;
const knownIds = new Set<string>();
let seeded = false;

// New rows slide in; the first load does not (everything would animate).
watch(rows, (list) => {
  const incoming = list.filter((d) => !knownIds.has(d.id));
  for (const d of list) knownIds.add(d.id);
  if (!seeded) {
    seeded = list.length > 0 || seeded;
    return;
  }
  if (!incoming.length) return;
  freshIds.value = new Set(incoming.map((d) => d.id));
  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => (freshIds.value = new Set()), FRESH_MS);
});

onMounted(() => {
  pollTimer = setInterval(() => {
    if (!live.value || document.hidden) return;
    // Poll errors are transient by nature; the next tick retries.
    store.loadDelegations(props.agentId).catch(() => {});
  }, POLL_MS);
});

onUnmounted(() => {
  clearInterval(pollTimer);
  clearTimeout(freshTimer);
});

function outcome(row: IAgentDelegation): string {
  if (row.status === 'answered') return 'answered';
  if (row.status === 'waiting') return 'waiting';
  return row.errorCode ? (CAUSES[row.errorCode] ?? row.errorCode) : row.status;
}

function outcomeClass(row: IAgentDelegation): string {
  if (row.status === 'answered')
    return 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-500';
  if (row.status === 'waiting') return '';
  return 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20';
}

function response(row: IAgentDelegation): string {
  if (row.excerpt) return row.excerpt;
  if (row.status === 'waiting') return 'Waiting for the peer…';
  return `No response — ${outcome(row)}.`;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function barWidth(row: IAgentDelegation): string {
  if (row.durationMs === null) return '0px';
  return `${Math.max(4, Math.round((56 * row.durationMs) / maxTookMs.value))}px`;
}

function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}
</script>

<template>
  <section>
    <div class="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <h3 class="font-semibold tracking-tight">Delegations</h3>
        <span
          v-if="live"
          class="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-emerald-600 dark:text-emerald-500"
        >
          <span class="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          LIVE
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-if="peerFilter"
          size="sm"
          class="h-7 rounded-full text-xs"
          title="Show all peers again"
          @click="emit('update:peerFilter', null)"
        >
          {{ peerFilter.name }} ✕
        </Button>
        <div class="inline-flex rounded-full bg-muted p-0.5">
          <button
            v-for="f in OUTCOME_FILTERS"
            :key="f"
            type="button"
            class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
            :class="
              outcomeFilter === f
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="outcomeFilter = f"
          >
            {{ f }}
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-7 rounded-full text-xs"
          @click="live = !live"
        >
          {{ live ? 'Pause' : 'Resume' }}
        </Button>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div
        v-for="row in shown"
        :key="row.id"
        class="overflow-hidden rounded-xl border bg-card"
        :class="freshIds.has(row.id) && 'animate-feed-in'"
      >
        <button
          type="button"
          class="block w-full px-3.5 py-2.5 text-left"
          @click="toggle(row.id)"
        >
          <div class="flex items-center gap-2.5">
            <Badge
              variant="secondary"
              class="flex-none"
              :title="row.peerAgentId === null ? 'External agent' : undefined"
            >
              {{ row.peerName
              }}<span
                v-if="row.peerAgentId === null"
                class="ml-1 text-sky-700 dark:text-sky-400"
                >· ext</span
              >
            </Badge>
            <span
              class="min-w-0 flex-1 text-sm"
              :class="expandedId === row.id ? 'whitespace-normal' : 'truncate'"
            >
              {{ row.task }}
            </span>
            <Badge
              :variant="row.status === 'waiting' ? 'secondary' : 'outline'"
              class="flex-none"
              :class="outcomeClass(row)"
            >
              {{ outcome(row) }}
            </Badge>
          </div>
          <div
            class="mt-1.5 flex items-center gap-2.5 text-xs text-muted-foreground"
          >
            <DateTimeAgoInline :date="row.startedAt" />
            <span>·</span>
            <span class="tabular-nums">{{ duration(row.durationMs) }}</span>
            <span
              class="h-1 rounded-sm"
              :class="
                row.status === 'failed' || row.status === 'rejected'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/40'
              "
              :style="{ width: barWidth(row) }"
            />
          </div>
        </button>

        <div
          v-if="expandedId === row.id"
          class="space-y-2.5 border-t bg-muted/40 px-3.5 py-3"
        >
          <div>
            <p
              class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Task sent · {{ formatDateTime(row.startedAt) }}
            </p>
            <p class="text-sm">{{ row.task }}</p>
          </div>
          <div v-if="row.reason">
            <p
              class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Why it delegated
            </p>
            <p class="text-sm">{{ row.reason }}</p>
          </div>
          <div>
            <p
              class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Peer response
            </p>
            <p class="text-sm">{{ response(row) }}</p>
          </div>
        </div>
      </div>

      <div
        v-if="!shown.length"
        class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
      >
        {{ rows.length ? 'Nothing matches this filter.' : 'No delegations yet.' }}
      </div>
    </div>
  </section>
</template>

<style scoped>
@keyframes feed-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}
.animate-feed-in {
  animation: feed-in 0.45s ease;
}
</style>
