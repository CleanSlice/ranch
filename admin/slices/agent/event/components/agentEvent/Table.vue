<script setup lang="ts">
import type { IAgentEvent } from '#agentEvent/domain';
import { TONE_CLASSES, statusTone } from '#agentEvent/utils/eventTone';
import { formatDateTime, formatStamp, toDate } from '#common/utils/format';
// Imported by hand, unlike everywhere else: this file is itself `Table.vue`,
// and a bare `<Table>` in its own template may resolve to the component it is
// in. An explicit binding always wins.
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

/**
 * The events table, shared by the /events page and the agent's Events
 * section. Rows are drawn by id from the store (docs/state.md).
 *
 * - `ids` given: draws exactly those rows — the page passes its filtered list
 *   and owns loading and refresh itself.
 * - `agentId` given (and no `ids`): the table is that agent's section. It
 *   loads the agent's events, keeps them fresh while mounted and pages them.
 */
const props = defineProps<{
  agentId?: string;
  ids?: string[];
  /**
   * One incident's reports, shown under its row: the agent and whether the
   * team was told are already said by the row above, so both columns go.
   */
  timeline?: boolean;
}>();

const store = useAgentEventStore();
const owns = computed(() => props.ids === undefined && !!props.agentId);
const showAgent = computed(() => !props.agentId && !props.timeline);

const { pending, error } = useAsyncData(
  `admin-agent-events-table-${props.agentId ?? 'page'}`,
  async () => {
    if (!owns.value || !props.agentId) return true;
    await Promise.all([
      store.fetchForAgent(props.agentId),
      store.fetchIncidents({ agentId: props.agentId }),
    ]);
    return true;
  },
  { server: false },
);

onMounted(() => {
  if (owns.value) store.watch(props.agentId);
});
onBeforeUnmount(() => {
  if (owns.value) store.unwatch(props.agentId);
});

const rows = computed<IAgentEvent[]>(() => {
  const ids = props.ids ?? (props.agentId ? (store.byAgentIds[props.agentId] ?? []) : store.latestIds);
  const out: IAgentEvent[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const event = store.eventById(ids[i]!);
    if (event) out.push(event);
  }
  return out;
});

/** Sent late, or held up on the way: say when Ranch actually got it. */
const RECEIVED_LATE_MS = 60_000;
function receivedLate(event: IAgentEvent): boolean {
  const occurred = toDate(event.occurredAt);
  const received = toDate(event.receivedAt);
  if (!occurred || !received) return false;
  return Math.abs(received.getTime() - occurred.getTime()) > RECEIVED_LATE_MS;
}

// The notification belongs to the incident; it is shown once, on the row that
// opened it, not repeated on every report that joined.
function notificationsOf(event: IAgentEvent) {
  if (event.outcome !== 'opened' || !event.incidentId) return null;
  return store.incidentById(event.incidentId)?.notifications ?? null;
}

const hasMore = computed(() => owns.value && !!store.nextCursor(props.agentId));
const loadingMore = ref(false);
async function loadMore() {
  loadingMore.value = true;
  try {
    await store.fetchMore(props.agentId);
  } finally {
    loadingMore.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="owns && error"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ error.message }}
    </div>

    <p v-if="owns && pending && !rows.length" class="text-sm text-muted-foreground">
      Loading events…
    </p>

    <Table v-else-if="rows.length">
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead v-if="showAgent">Agent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Cause</TableHead>
          <TableHead>Reported by</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead v-if="!timeline">Notification</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="event in rows" :key="event.id">
          <TableCell class="whitespace-nowrap align-top">
            <div :title="formatDateTime(event.occurredAt)">
              {{ formatStamp(event.occurredAt) }}
            </div>
            <div
              v-if="receivedLate(event)"
              class="text-xs text-muted-foreground"
              :title="formatDateTime(event.receivedAt)"
            >
              received {{ formatStamp(event.receivedAt) }}
            </div>
          </TableCell>
          <TableCell v-if="showAgent" class="align-top">
            <NuxtLink
              v-if="event.agentId"
              :to="`/agents/${event.agentId}?tab=events`"
              class="font-medium hover:underline"
            >
              {{ event.agentName ?? event.agentRef }}
            </NuxtLink>
            <template v-else>
              <!-- The sender's own reference, as received. -->
              <div class="font-mono text-xs break-all">{{ event.agentRef }}</div>
              <div class="text-xs text-muted-foreground">Unknown agent</div>
            </template>
          </TableCell>
          <TableCell class="align-top">
            <Badge variant="outline" :class="TONE_CLASSES[statusTone(event.status).tone]">
              {{ statusTone(event.status).label }}
            </Badge>
          </TableCell>
          <!-- As received: never translated, reworded or cut — only clamped
               on screen, with the whole text on hover. -->
          <TableCell class="max-w-md align-top whitespace-normal">
            <div
              v-if="event.reason"
              class="line-clamp-3 font-mono text-xs break-words whitespace-pre-wrap"
              :title="event.reason"
            >
              {{ event.reason }}
            </div>
            <span v-else class="text-muted-foreground">—</span>
          </TableCell>
          <TableCell class="align-top">
            <div>{{ event.senderName }}</div>
            <div v-if="event.tool" class="text-xs text-muted-foreground">{{ event.tool }}</div>
          </TableCell>
          <TableCell class="align-top">
            <AgentEventOutcomeBadge :outcome="event.outcome" />
          </TableCell>
          <TableCell v-if="!timeline" class="align-top">
            <AgentEventDeliveryBadge :notifications="notificationsOf(event)" />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <p v-else-if="!(owns && error)" class="text-sm text-muted-foreground">
      {{ agentId ? 'Nothing has been reported for this agent.' : 'No events.' }}
    </p>

    <div v-if="hasMore">
      <Button variant="outline" size="sm" :disabled="loadingMore" @click="loadMore">
        Load more
      </Button>
    </div>
  </div>
</template>
