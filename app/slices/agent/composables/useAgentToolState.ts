import type { MaybeRefOrGetter } from "vue";
import type { IAgentData } from "#agent/domain";
import { toolStateView } from "#agent/utils/toolState";

/** How often the detail is read again: the attempt count moves while a start waits. */
const CONNECTING_POLL_MS = 5_000;
/** A limited agent can stay so for hours; its servers change rarely. */
const LIMITED_POLL_MS = 30_000;

/**
 * The tool-server mark of the open agent (CLEAN-245), for someone who may
 * manage it. Twin of `admin/slices/agent/agent/composables/useAgentToolState.ts`.
 *
 * The word is on the agent's record: the list poll writes it, and in an open
 * chat the hub's `agent_status` patches it at once (the chat host does that).
 * The detail (which server, which attempt) is behind
 * `GET /agents/:id/tool-state`: asked for only while the word is set and only
 * for a manager — a User's page never makes the request.
 */
export function useAgentToolState(
  agent: MaybeRefOrGetter<IAgentData | null | undefined>,
  manager: MaybeRefOrGetter<boolean>,
) {
  const agentStore = useAgentStore();

  const summary = computed(() => {
    const current = toValue(agent);
    return current?.status === "running" ? current.toolState : null;
  });
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
    () => [toValue(agent)?.id, summary.value, toValue(manager)] as const,
    ([id, word, mayManage]) => {
      stop();
      if (!id || !word || !mayManage || !import.meta.client) return;
      now.value = Date.now();
      clock = setInterval(() => {
        now.value = Date.now();
      }, 1000);
      void agentStore.fetchToolState(id);
      poller = setInterval(
        () => void agentStore.fetchToolState(id),
        word === "connecting" ? CONNECTING_POLL_MS : LIMITED_POLL_MS,
      );
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);

  const toolView = computed(() => {
    const current = toValue(agent);
    if (!current || !toValue(manager)) return null;
    return toolStateView({
      status: current.status,
      summary: summary.value,
      detail: agentStore.toolStateFor(current.id) ?? null,
      manager: true,
      now: now.value,
    });
  });

  return { toolView };
}
