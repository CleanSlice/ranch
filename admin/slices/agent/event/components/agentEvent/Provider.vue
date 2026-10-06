<script setup lang="ts">
import type { IAgentIncident } from '#agentEvent/domain';
import {
  TONE_CLASSES,
  deliveryState,
  isNotNotified,
  statusTone,
} from '#agentEvent/utils/eventTone';
import { formatDateTime, formatSpan, formatStamp } from '#common/utils/format';

/**
 * The /events page: open incidents first, then everything that was reported,
 * newest first. Content comes from the store by id; `useAsyncData` is here
 * for the loading and error state only (docs/state.md).
 */
const store = useAgentEventStore();

const { pending, error } = useAsyncData(
  'admin-agent-events',
  async () => {
    await Promise.all([
      store.fetchLatest(),
      store.fetchIncidents(),
      // The banner is a courtesy: a failure to read the destination must not
      // take the list down with it.
      store.fetchDestination().catch(() => null),
    ]);
    return true;
  },
  { server: false },
);

onMounted(() => store.watch());
onBeforeUnmount(() => store.unwatch());

type Segment = 'all' | 'failures' | 'notNotified';
const SEGMENTS: readonly { key: Segment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failures', label: 'Failures' },
  { key: 'notNotified', label: 'Not notified' },
];

const query = ref('');
const segment = ref<Segment>('all');

// "Not notified" asks the same function the badge is drawn from, so the
// filter and the column cannot disagree.
function notNotified(incidentId: string | null): boolean {
  if (!incidentId) return false;
  return isNotNotified(deliveryState(store.incidentById(incidentId)?.notifications));
}

const ids = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return store.latestIds.filter((id) => {
    const event = store.eventById(id);
    if (!event) return false;
    if (needle && !(event.agentName ?? event.agentRef).toLowerCase().includes(needle)) {
      return false;
    }
    if (segment.value === 'failures') return event.status !== 'recovered';
    if (segment.value === 'notNotified') {
      return event.outcome === 'opened' && notNotified(event.incidentId);
    }
    return true;
  });
});

const openIncidents = computed<IAgentIncident[]>(() => {
  const out: IAgentIncident[] = [];
  for (const id of store.openIncidentIds) {
    const incident = store.incidentById(id);
    if (incident && incident.state === 'open') out.push(incident);
  }
  return out;
});

const hasMore = computed(() => !!store.nextCursor());
const loadingMore = ref(false);
async function loadMore() {
  loadingMore.value = true;
  try {
    await store.fetchMore();
  } finally {
    loadingMore.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="store.destination?.configured === false"
      class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      Nobody outside this console is being notified.
      <NuxtLink to="/settings/notifications" class="font-medium underline">
        Settings → Notifications
      </NuxtLink>
    </div>

    <div
      v-if="error"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ error.message }}
    </div>

    <section v-if="openIncidents.length" class="flex flex-col gap-2">
      <h2 class="text-sm font-medium">Open incidents</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Cause</TableHead>
            <TableHead>Since</TableHead>
            <TableHead>Reported by</TableHead>
            <TableHead>Notification</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="incident in openIncidents" :key="incident.id">
            <TableCell class="align-top">
              <NuxtLink
                v-if="incident.agentId"
                :to="`/agents/${incident.agentId}?tab=events`"
                class="font-medium hover:underline"
              >
                {{ incident.agentName }}
              </NuxtLink>
              <span v-else class="font-medium">{{ incident.agentName }}</span>
            </TableCell>
            <TableCell class="align-top">
              <Badge variant="outline" :class="TONE_CLASSES[statusTone(incident.status).tone]">
                {{ statusTone(incident.status).label }}
              </Badge>
            </TableCell>
            <!-- As received; clamped on screen only, whole text on hover. -->
            <TableCell class="max-w-md align-top whitespace-normal">
              <div
                v-if="incident.reason"
                class="line-clamp-3 font-mono text-xs break-words whitespace-pre-wrap"
                :title="incident.reason"
              >
                {{ incident.reason }}
              </div>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="whitespace-nowrap align-top" :title="formatDateTime(incident.openedAt)">
              <div>{{ formatStamp(incident.openedAt) }}</div>
              <div class="text-xs text-muted-foreground">
                {{ formatSpan(incident.openedAt, store.refreshedAt) }}
              </div>
            </TableCell>
            <TableCell class="align-top whitespace-normal">
              {{ incident.witnesses.join(', ') }}
            </TableCell>
            <TableCell class="align-top">
              <AgentEventDeliveryBadge :notifications="incident.notifications" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>

    <ListToolbar>
      <ListSearch v-model="query" placeholder="Search by agent" />
      <ListSegments v-model="segment" :options="SEGMENTS" label="Events shown" />
    </ListToolbar>

    <p v-if="pending && !store.latestIds.length" class="text-sm text-muted-foreground">
      Loading events…
    </p>
    <AgentEventTable v-else :ids="ids" />

    <div v-if="hasMore">
      <Button variant="outline" size="sm" :disabled="loadingMore" @click="loadMore">
        Load more
      </Button>
    </div>
  </div>
</template>
