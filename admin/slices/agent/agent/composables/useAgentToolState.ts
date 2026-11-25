import type { MaybeRefOrGetter } from "vue";
import type { IAgentData } from "#agent/domain";
import { useAgentAccess } from "#agent/composables/useAgentAccess";
import { toolStateView } from "#agent/utils/toolState";

/** How often the detail is read again: the attempt count moves while a start waits. */
const CONNECTING_POLL_MS = 5_000;
/** A limited agent can stay so for hours; its servers change rarely. */
const LIMITED_POLL_MS = 30_000;

/**
 * The tool-server mark of one agent (CLEAN-245), in this console's words.
 *
 * The word comes off the status stream and costs nothing. The detail (which
 * server, which attempt) is behind `GET /agents/:id/tool-state`: it is asked
 * for only while the word is set and only for a viewer who may manage the
 * agent, and `poll` says whether THIS caller keeps it fresh — one per agent
 * page (the lifecycle composable); every other reader renders what the store
 * holds.
 */
export function useAgentToolState(
  agentId: string,
  agent: MaybeRefOrGetter<IAgentData | null | undefined>,
  options: { poll?: boolean } = {},
) {
  const statusStore = useAgentStatusStore();
  const { canManage } = useAgentAccess(agent);

  const summary = computed(() => statusStore.tools[agentId] ?? null);
  // The line counts seconds ("attempt 3, 40 s"), so it needs a clock of its
  // own while there is something to count.
  const now = ref(Date.now());

  let clock: ReturnType<typeof setInterval> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  function stop() {
    if (clock) clearInterval(clock);
    if (poller) clearInterval(poller);
    clock = null;
    poller = null;
  }

  watch(
    () => [summary.value, canManage.value] as const,
    ([word, manager]) => {
      stop();
      if (!word || !import.meta.client) return;
      now.value = Date.now();
      clock = setInterval(() => {
        now.value = Date.now();
      }, 1000);
      if (!options.poll || !manager) return;
      void statusStore.fetchToolState(agentId);
      poller = setInterval(
        () => void statusStore.fetchToolState(agentId),
        word === "connecting" ? CONNECTING_POLL_MS : LIMITED_POLL_MS,
      );
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);

  const toolView = computed(() => {
    const current = toValue(agent);
    if (!current) return null;
    return toolStateView({
      status: current.status,
      summary: summary.value,
      detail: statusStore.toolStates[agentId] ?? null,
      manager: canManage.value,
      now: now.value,
    });
  });

  return { toolView };
}
