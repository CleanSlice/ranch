/**
 * The installation's fleet for a page that shows all of it: the agent list
 * and, for Owner / Admin, cluster capacity and the agent-to-agent links,
 * all kept fresh while the page is
 * mounted (CLEAN-217; moved out of the workspace provider so the profile page
 * shares it instead of copying the timers).
 *
 * One list request under the key `agents`, shared on purpose with the
 * resolver page and with every other caller of this composable, so landing
 * on a second page does not re-fetch what the first already read. The
 * request gives `pending` and `refresh`; callers render the store's
 * collection (docs/state.md), the same records an open chat reads by id.
 *
 * Why a poll: the map and the profile show every agent's runtime state, so
 * they have to keep up with agents other people start and stop. The app
 * console has no status stream of its own (admin's SSE feed is public, but
 * porting the client is a separate piece of work), so this polls every 30 s,
 * the cadence the cards screen already polled capacity at. An open agent
 * keeps its own 3 s poll while it is transitioning.
 *
 * Not `async`: the lifecycle hooks have to be registered before the first
 * `await`, while the component instance is still current. Callers that want
 * to block rendering on the first load `await fleet.ready`.
 */
export function useAgentFleet() {
  const agentStore = useAgentStore();
  const authStore = useAuthStore();

  // Capacity is an operator's number: everyone else gets no request at all,
  // which is the rule the cards screen already applied.
  const canManage = computed(() =>
    authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
  );

  const request = useAsyncData('agents', () => agentStore.fetchAll());
  const { agents } = storeToRefs(agentStore);
  const capacity = computed(() => agentStore.capacity);
  // Who can ask whom, for the lines on the orbit map: an operator read like
  // capacity, and refreshed with it.
  const links = computed(() => agentStore.links);

  const POLL_MS = 30_000;
  let listTimer: ReturnType<typeof setInterval> | null = null;
  let capacityTimer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    listTimer = setInterval(() => void request.refresh(), POLL_MS);
    if (!canManage.value) return;
    void agentStore.fetchCapacity();
    void agentStore.fetchLinks();
    capacityTimer = setInterval(() => {
      void agentStore.fetchCapacity();
      void agentStore.fetchLinks();
    }, POLL_MS);
  });
  onUnmounted(() => {
    if (listTimer) clearInterval(listTimer);
    if (capacityTimer) clearInterval(capacityTimer);
  });

  return {
    /** Resolves when the first list request has settled. */
    ready: request,
    pending: request.pending,
    refresh: request.refresh,
    agents,
    capacity,
    links,
    canManage,
  };
}
