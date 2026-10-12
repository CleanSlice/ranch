<script setup lang="ts">
import { deliveryState, isNotNotified } from '#agentEvent/utils/eventTone';
import { compareInstants, formatNumber } from '#common/utils/format';

/**
 * The /events page. Two views of the same record:
 *
 * - **Incidents** (the default) — one row per stretch of trouble for an
 *   agent. This is what a person opens the page for: what is down, since
 *   when, was anybody told. A row opens into its reports.
 * - **Event log** — every report as it arrived, newest first, including the
 *   ones that belong to no incident (an unknown agent, an agent that was
 *   stopped or being restarted). The audit trail.
 *
 * The view lives in `?view=` so it can be linked; the default carries no
 * parameter. Content comes from the store by id; `useAsyncData` is here for
 * the loading and error state only (docs/state.md).
 */
const store = useAgentEventStore();
const route = useRoute();
const router = useRouter();

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

type View = 'incidents' | 'log';
const view = computed<View>(() => (route.query.view === 'log' ? 'log' : 'incidents'));

// The 5-second refresh asks only for what the open tab shows, so the store
// is told which one that is; the tab that was not on screen is caught up the
// moment it is opened rather than on the next beat.
onMounted(() => {
  store.setPageView(view.value);
  store.watch();
});
onBeforeUnmount(() => store.unwatch());
watch(view, (next) => {
  store.setPageView(next);
  void (next === 'log' ? store.fetchLatest() : store.fetchIncidents()).catch(() => {});
});
function setView(next: string | number) {
  void router.replace({
    query: { ...route.query, view: next === 'log' ? 'log' : undefined },
  });
}

const query = ref('');
const matches = (name: string | null | undefined): boolean => {
  const needle = query.value.trim().toLowerCase();
  return !needle || (name ?? '').toLowerCase().includes(needle);
};

// ── Incidents ───────────────────────────────────────────────────────────
type IncidentSegment = 'open' | 'closed' | 'all';
const incidentSegment = ref<IncidentSegment>('open');

const openCount = computed(
  () => store.openIncidentIds.filter((id) => store.incidentById(id)?.state === 'open').length,
);
const incidentSegments = computed<readonly { key: IncidentSegment; label: string }[]>(() => [
  { key: 'open', label: openCount.value ? `Open ${openCount.value}` : 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]);

const incidentIds = computed(() => {
  // Open incidents come from their own, complete list; the recent list is a
  // page of everything. Together, once each, newest first.
  const ids = [...new Set([...store.openIncidentIds, ...store.incidentIds])];
  return ids
    .filter((id) => {
      const incident = store.incidentById(id);
      if (!incident || !matches(incident.agentName)) return false;
      if (incidentSegment.value === 'all') return true;
      return incident.state === incidentSegment.value;
    })
    .sort((a, b) =>
      compareInstants(store.incidentById(b)!.openedAt, store.incidentById(a)!.openedAt),
    );
});

const hasMoreIncidents = computed(
  () => incidentSegment.value !== 'open' && !!store.incidentsCursor,
);

// ── Event log ───────────────────────────────────────────────────────────
type LogSegment = 'all' | 'failures' | 'noIncident' | 'notNotified';
const LOG_SEGMENTS: readonly { key: LogSegment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failures', label: 'Failures' },
  { key: 'noIncident', label: 'No incident' },
  { key: 'notNotified', label: 'Not notified' },
];
const logSegment = ref<LogSegment>('all');

// "Not notified" asks the same function the badge is drawn from, so the
// filter and the column cannot disagree.
function notNotified(incidentId: string | null): boolean {
  if (!incidentId) return false;
  return isNotNotified(deliveryState(store.incidentById(incidentId)?.notifications));
}

const eventIds = computed(() =>
  store.latestIds.filter((id) => {
    const event = store.eventById(id);
    if (!event || !matches(event.agentName ?? event.agentRef)) return false;
    switch (logSegment.value) {
      case 'failures':
        return event.status !== 'recovered';
      case 'noIncident':
        // Recorded and attached to nothing: an unknown agent, or an agent
        // that was stopped or being started when the report came.
        return event.incidentId === null;
      case 'notNotified':
        return event.outcome === 'opened' && notNotified(event.incidentId);
      default:
        return true;
    }
  }),
);

const hasMoreEvents = computed(() => !!store.nextCursor());

const loadingMore = ref(false);
async function loadMore(what: 'incidents' | 'events') {
  loadingMore.value = true;
  try {
    await (what === 'incidents' ? store.fetchMoreIncidents() : store.fetchMore());
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

    <Tabs :model-value="view" @update:model-value="setView">
      <TabsList>
        <TabsTrigger value="incidents">
          Incidents
          <span
            v-if="openCount"
            class="rounded-full bg-red-100 px-1.5 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {{ openCount }}
          </span>
        </TabsTrigger>
        <TabsTrigger value="log">Event log</TabsTrigger>
      </TabsList>
    </Tabs>

    <template v-if="view === 'incidents'">
      <ListToolbar>
        <ListSearch v-model="query" placeholder="Search by agent" />
        <ListSegments
          v-model="incidentSegment"
          :options="incidentSegments"
          label="Incidents shown"
        />
      </ListToolbar>

      <p v-if="pending && !incidentIds.length" class="text-sm text-muted-foreground">
        Loading incidents…
      </p>
      <AgentEventIncidentList v-else-if="incidentIds.length" :ids="incidentIds" />
      <div
        v-else
        class="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
      >
        <template v-if="query.trim()">No incident matches “{{ query.trim() }}”.</template>
        <template v-else-if="incidentSegment === 'open'">
          No open incidents.
          <button
            type="button"
            class="font-medium text-foreground underline"
            @click="incidentSegment = 'closed'"
          >
            See closed ones
          </button>
        </template>
        <template v-else>No incidents yet.</template>
      </div>

      <div
        v-if="hasMoreIncidents"
        class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      >
        <Button
          variant="outline"
          size="sm"
          :disabled="loadingMore"
          @click="loadMore('incidents')"
        >
          Load more
        </Button>
        <!-- Search and the segments work on what is loaded: say how much
             that is, so "nothing found" is not read as "nothing happened". -->
        <span>
          The latest {{ formatNumber(store.incidentIds.length) }} incidents are
          loaded; older ones are not searched until they are.
        </span>
      </div>
    </template>

    <template v-else>
      <ListToolbar>
        <ListSearch v-model="query" placeholder="Search by agent" />
        <ListSegments v-model="logSegment" :options="LOG_SEGMENTS" label="Events shown" />
      </ListToolbar>

      <p v-if="pending && !store.latestIds.length" class="text-sm text-muted-foreground">
        Loading events…
      </p>
      <AgentEventTable v-else :ids="eventIds" />

      <div
        v-if="hasMoreEvents"
        class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      >
        <Button
          variant="outline"
          size="sm"
          :disabled="loadingMore"
          @click="loadMore('events')"
        >
          Load more
        </Button>
        <span>
          The latest {{ formatNumber(store.latestIds.length) }} events are
          loaded; older ones are not searched until they are. One agent’s
          whole history is on its own page.
        </span>
      </div>
    </template>
  </div>
</template>
