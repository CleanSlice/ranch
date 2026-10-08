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
/** One page of incidents: the newest ones, and each "Load more" after it. */
const RECENT_INCIDENTS = 50;
/** One page of an incident's reports. */
const TIMELINE_SIZE = 50;
// Open incidents are read whole. A page is the API's maximum; there is at
// most one open incident per agent, so one page is the normal case and the
// cap is a thousand agents down at once.
const OPEN_PAGE_SIZE = 200;
const OPEN_PAGES_MAX = 5;

/** The two views of the /events page. */
export type EventPageViewTypes = 'incidents' | 'log';
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
  // An expanded incident's reports, as ids into `events`, with where its
  // "Load older" continues from.
  const incidentEvents = ref<Record<string, IEventView>>({});
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
    incidentEvents.value[incidentId]?.ids;
  const incidentEventsCursor = (incidentId: string): string | null =>
    incidentEvents.value[incidentId]?.nextCursor ?? null;

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

  /**
   * Every open incident, not a first page of them: "what is down right now"
   * must not stop at a page size. One request in practice — there is at most
   * one open incident per agent — and the cursor is followed when there are
   * more than a page holds.
   */
  async function fetchOpenIncidents(agentId?: string) {
    const open: IAgentIncident[] = [];
    let before: string | undefined;
    for (let page = 0; page < OPEN_PAGES_MAX; page += 1) {
      const res = await getService().listIncidents({
        agentId,
        state: 'open',
        limit: OPEN_PAGE_SIZE,
        before,
      });
      open.push(...res.items);
      if (!res.nextCursor) break;
      before = res.nextCursor;
    }
    incidents.value = upsertById(incidents.value, open);
    const openIds = open.map((i) => i.id);
    // An agent's answer says nothing about the other agents' incidents.
    const kept = agentId
      ? openIncidentIds.value.filter(
          (id) => incidents.value[id]?.agentId !== agentId && !openIds.includes(id),
        )
      : [];
    openIncidentIds.value = [...openIds, ...kept];
    refreshedAt.value = Date.now();
  }

  /**
   * The newest incidents, open or closed: the Incidents tab's list, and what
   * gives a row of the event log its delivery state.
   */
  async function fetchRecentIncidents(agentId?: string) {
    const recent = await getService().listIncidents({ agentId, limit: RECENT_INCIDENTS });
    incidents.value = upsertById(incidents.value, recent.items);
    // The all-agents answer is the Incidents tab's own list, newest first;
    // what "Load more" brought in below it stays.
    if (!agentId) {
      recentIncidents.value = refreshView(
        recentIncidents.value,
        recent.items.map((i) => i.id),
        recent.nextCursor,
      );
    }
    refreshedAt.value = Date.now();
  }

  /** Both lists — for a first load. The refresh asks only for what is shown. */
  async function fetchIncidents(query: { agentId?: string } = {}) {
    await Promise.all([
      fetchOpenIncidents(query.agentId),
      fetchRecentIncidents(query.agentId),
    ]);
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

  const timelineOf = (incidentId: string): IEventView =>
    incidentEvents.value[incidentId] ?? emptyView();

  function setTimeline(incidentId: string, view: IEventView) {
    incidentEvents.value = { ...incidentEvents.value, [incidentId]: view };
  }

  /** One incident's newest reports — what its row expands into. */
  async function fetchIncidentEvents(incidentId: string) {
    const page = await getService().listEvents({ incidentId, limit: TIMELINE_SIZE });
    events.value = upsertById(events.value, page.items);
    setTimeline(
      incidentId,
      refreshView(timelineOf(incidentId), page.items.map((e) => e.id), page.nextCursor),
    );
  }

  /** The next older page of an incident's reports. */
  async function fetchMoreIncidentEvents(incidentId: string) {
    const before = timelineOf(incidentId).nextCursor;
    if (!before) return;
    const page = await getService().listEvents({ incidentId, before, limit: TIMELINE_SIZE });
    events.value = upsertById(events.value, page.items);
    setTimeline(
      incidentId,
      appendView(timelineOf(incidentId), page.items.map((e) => e.id), page.nextCursor),
    );
  }

  /** Which of the page's two views is on screen — the refresh follows it. */
  const pageView = ref<EventPageViewTypes>('incidents');
  function setPageView(next: EventPageViewTypes) {
    pageView.value = next;
  }

  // One timer for every watcher (the page, an agent's section, both at once).
  // Each beat asks only for what is on screen — two small requests, each an
  // indexed read of one page:
  //   Incidents tab → the open incidents and the newest page of incidents;
  //   Event log tab → the newest page of events, and of incidents (for the
  //                   delivery state of a row);
  //   an agent's section → the same two, for that agent.
  const watchers = createWatchers({
    intervalMs: EVENT_REFRESH_MS,
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    tick: (keys) => {
      for (const key of keys) {
        const agentId = key === LATEST ? undefined : key;
        const beat =
          !agentId && pageView.value === 'incidents'
            ? [fetchOpenIncidents(), fetchRecentIncidents()]
            : [load(agentId), fetchRecentIncidents(agentId)];
        // A failed beat is not an error on screen: the next one tries again.
        void Promise.all(beat).catch(() => {});
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
    incidentEventsCursor,
    nextCursor,
    pageView,
    setPageView,
    fetchLatest,
    fetchMore,
    fetchForAgent,
    fetchIncidents,
    fetchMoreIncidents,
    fetchIncidentEvents,
    fetchMoreIncidentEvents,
    watch,
    unwatch,
    fetchDestination,
    saveDestination,
    removeDestination,
    sendTest,
  };
});
