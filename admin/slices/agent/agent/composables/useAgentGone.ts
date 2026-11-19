/**
 * The page that hosts an agent's chat leaves when the hub says the signed-in
 * account does not reach that agent (CLEAN-231). Twin of
 * `app/slices/agent/composables/useAgentGone.ts`.
 *
 * The hub answers `AGENT_NOT_FOUND` when a socket is refused at the
 * handshake, on a message, and when access is taken away while the chat is
 * open. The bridle store has by then closed the socket and emptied the
 * conversation, and marks the agent; this is the other half, which belongs
 * to the agent slice: the record leaves the store's collection, so the rail
 * does not offer it, and the address changes to the agents, whose resolver
 * opens another agent or shows the empty state.
 *
 * Called by the workspace, which stays mounted across `/agents/:id`: `id` is
 * read each time, and a mark set before the page was opened is acted on too.
 * Where this console differs from the app: the Ranch admin agent also has a
 * page of its own (`/rancher`), which leaves through the reach the layout
 * keeps (`adminReach`), so the mark is turned into that as well.
 */
export function useAgentGone(id: () => string) {
  const agentStore = useAgentStore();
  const bridleStore = useBridleStore();

  watch(
    () => bridleStore.unreachable[id()] === true,
    (gone) => {
      if (!gone) return;
      const agentId = id();
      if (agentStore.byId(agentId)?.isAdmin) agentStore.adminReach = 'hidden';
      agentStore.forget(agentId);
      bridleStore.clearUnreachable(agentId);
      void navigateTo('/agents', { replace: true });
    },
    { immediate: true },
  );
}
