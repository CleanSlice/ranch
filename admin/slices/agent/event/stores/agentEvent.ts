import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentEventService,
  IAgentEvent,
  IAgentIncident,
  INotificationDestination,
  ITestDelivery,
} from '#agentEvent/domain';
import {
  appendView,
  createWatchers,
  emptyView,
  refreshView,
  upsertById,
  type IEventView,
} from '#agentEvent/utils/eventList';

const getService = createServiceGetter<AgentEventService>('$agentEventService');

/** "Within a few seconds" (spec FR-025): a new event shows up inside 5 s. */
export const EVENT_REFRESH_MS = 5000;
const PAGE_SIZE = 50;
/** Enough closed incidents to give the rows on screen their delivery state. */
const RECENT_INCIDENTS = 100;
/** An incident's whole timeline in one page — the API's maximum. */
const TIMELINE_SIZE = 200;
/** The watcher key of the all-agents list; an agent's key is its id. */
const LATEST = '';

export const useAgentEventStore = defineStore('agentEvent', () => {
  // An event and an incident live here once (docs/state.md). Every list on
  // screen is an order of ids over these two maps; a fetch or a refresh
  // upserts into them and never keeps rows of its own.
  const events = ref<Record<string, IAgentEvent>>({});
  const incidents = ref<Record<string, IAgentIncident>>({});
  const latest = ref<IEventView>(emptyView());
  const byAgent = ref<Record<string, IEventView>>({});
  const openIncidentIds = ref<string[]>([]);
  // Every incident the Incidents tab has loaded, open or closed, newest first.
  const recentIncidents = ref<IEventView>(emptyView());
  // An expanded incident's reports, as ids into `events`.
  const incidentEvents = ref<Record<string, string[]>>({});
  // What the server said about the destination. Never the address: the API
  // does not return it and `saveDestination` does not keep its argument.
  const destination = ref<INotificationDestination | null>(null);
  /** When the store last heard from the server — the "now" of a time span. */
  const refreshedAt = ref<number>(Date.now());

  const latestIds = computed(() => latest.value.ids);
  const byAgentIds = computed(() => {
    const out: Record<string, string[]> = {};
    for (const [agentId, view] of Object.entries(byAgent.value)) out[agentId] = view.ids;
    return out;
  });

  const eventById = (id: string): IAgentEvent | undefined => events.value[id];
  const incidentById = (id: string): IAgentIncident | undefined => incidents.value[id];
  const viewOf = (agentId?: string): IEventView =>
    agentId ? (byAgent.value[agentId] ?? emptyView()) : latest.value;
  const nextCursor = (agentId?: string): string | null => viewOf(agentId).nextCursor;
  const incidentIds = computed(() => recentIncidents.value.ids);
  const incidentsCursor = computed(() => recentIncidents.value.nextCursor);
  /** `undefined` until the incident's reports were asked for. */
  const incidentEventIds = (incidentId: string): string[] | undefined =>
    incidentEvents.value[incidentId];

  function setView(agentId: string | undefined, view: IEventView) {
    if (agentId) byAgent.value = { ...byAgent.value, [agentId]: view };
    else latest.value = view;
  }

  async function load(agentId?: string) {
    const page = await getService().listEvents({ agentId, limit: PAGE_SIZE });
    events.value = upsertById(events.value, page.items);
    setView(
      agentId,
      refreshView(viewOf(agentId), page.items.map((e) => e.id), page.nextCursor),
    );
    refreshedAt.value = Date.now();
  }

  const fetchLatest = () => load();
  const fetchForAgent = (agentId: string) => load(agentId);

  /** The next older page of the all-agents list, or of one agent's. */
  async function fetchMore(agentId?: string) {
    const before = nextCursor(agentId);
    if (!before) return;
    const page = await getService().listEvents({ agentId, before, limit: PAGE_SIZE });
    events.value = upsertById(events.value, page.items);
    setView(
      agentId,
      appendView(viewOf(agentId), page.items.map((e) => e.id), page.nextCursor),
    );
  }

  /** Open incidents plus the recent ones, so a row can show its delivery. */
  async function fetchIncidents(query: { agentId?: string } = {}) {
    const { agentId } = query;
    const [open, recent] = await Promise.all([
      getService().listIncidents({ agentId, state: 'open', limit: RECENT_INCIDENTS }),
      getService().listIncidents({ agentId, limit: RECENT_INCIDENTS }),
    ]);
    // `open` last: both answers describe the same moment, give or take, and
    // the open list is the one the block above the table is drawn from.
    incidents.value = upsertById(incidents.value, [...recent.items, ...open.items]);
    const openIds = open.items.map((i) => i.id);
    // An agent's answer says nothing about the other agents' incidents.
    const kept = agentId
      ? openIncidentIds.value.filter(
          (id) => incidents.value[id]?.agentId !== agentId && !openIds.includes(id),
        )
      : [];
    openIncidentIds.value = [...openIds, ...kept];
    // The all-agents answer is also the Incidents tab's own list, newest
    // first; what "Load more" brought in below it stays.
    if (!agentId) {
      recentIncidents.value = refreshView(
        recentIncidents.value,
        recent.items.map((i) => i.id),
        recent.nextCursor,
      );
    }
    refreshedAt.value = Date.now();
  }

  /** The next older page of incidents, for the Incidents tab. */
  async function fetchMoreIncidents() {
    const before = recentIncidents.value.nextCursor;
    if (!before) return;
    const page = await getService().listIncidents({ before, limit: RECENT_INCIDENTS });
    incidents.value = upsertById(incidents.value, page.items);
    recentIncidents.value = appendView(
      recentIncidents.value,
      page.items.map((i) => i.id),
      page.nextCursor,
    );
  }

  /** One incident's reports, newest first — what its row expands into. */
  async function fetchIncidentEvents(incidentId: string) {
    const page = await getService().listEvents({ incidentId, limit: TIMELINE_SIZE });
    events.value = upsertById(events.value, page.items);
    incidentEvents.value = {
      ...incidentEvents.value,
      [incidentId]: page.items.map((e) => e.id),
    };
  }

  // One timer for every watcher (the page, an agent's section, both at once).
  const watchers = createWatchers({
    intervalMs: EVENT_REFRESH_MS,
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    tick: (keys) => {
      for (const key of keys) {
        const agentId = key === LATEST ? undefined : key;
        // A failed beat is not an error on screen: the next one tries again.
        void Promise.all([load(agentId), fetchIncidents({ agentId })]).catch(() => {});
      }
    },
  });

  function watch(agentId?: string) {
    if (!import.meta.client) return;
    watchers.watch(agentId ?? LATEST);
  }

  function unwatch(agentId?: string) {
    if (!import.meta.client) return;
    watchers.unwatch(agentId ?? LATEST);
  }

  async function fetchDestination() {
    destination.value = await getService().getDestination();
    return destination.value;
  }

  async function saveDestination(webhookUrl: string) {
    destination.value = await getService().saveDestination(webhookUrl);
    return destination.value;
  }

  // The API answers a removal with no body, so the new state is read back.
  async function removeDestination() {
    await getService().removeDestination();
    return fetchDestination();
  }

  /** Sends the test and re-reads the destination for its `lastDelivery`. */
  async function sendTest(): Promise<ITestDelivery> {
    const result = await getService().sendTest();
    await fetchDestination().catch(() => {});
    return result;
  }

  return {
    events,
    incidents,
    // The two view refs are returned so Pinia counts them as state; read the
    // id lists and `nextCursor()` rather than these.
    latest,
    byAgent,
    recentIncidents,
    incidentEvents,
    latestIds,
    byAgentIds,
    openIncidentIds,
    incidentIds,
    incidentsCursor,
    destination,
    refreshedAt,
    eventById,
    incidentById,
    incidentEventIds,
    nextCursor,
    fetchLatest,
    fetchMore,
    fetchForAgent,
    fetchIncidents,
    fetchMoreIncidents,
    fetchIncidentEvents,
    watch,
    unwatch,
    fetchDestination,
    saveDestination,
    removeDestination,
    sendTest,
  };
});
