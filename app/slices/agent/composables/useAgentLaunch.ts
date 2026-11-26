import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';
import {
  deriveLaunch,
  type LaunchFacts,
  type LaunchKind,
  type LaunchView,
} from '#agent/utils/launchSteps';

/** A launch as the chat overlay shows it (CLEAN-247). */
export interface IAgentLaunch {
  view: LaunchView;
  /** Changes with every new launch of this agent: the list starts over. */
  seq: number;
  /** The status stream is not connected: the list is its last known state. */
  stale: boolean;
}

const TRANSITIONAL = new Set(['pending', 'deploying']);
const FAILED = new Set(['failed', 'unreachable']);

// How long the completed step list stays before the chat shows through: long
// enough to read its last line, short enough not to delay the first message
// (which the queue sends on its own anyway).
const LAUNCH_DONE_HOLD_MS = 1200;

/**
 * An agent's launch as a list of steps, for the overlay over its chat. The
 * steps are derived by `launchSteps.ts` from reported facts; this is the
 * wiring and the memory a pure function cannot have: which launch is on
 * screen, how far it got, whether the instance that was there has gone.
 *
 * `requestInFlight` is the caller's own restart call, when it has one. A
 * launch somebody else started (the sheet, another tab, the agent itself)
 * shows the same way, off the status on the store's record.
 */
export function useAgentLaunch(
  agentId: string,
  agent: Ref<IAgentData | undefined>,
  requestInFlight: Ref<boolean>,
) {
  const agentStore = useAgentStore();
  const statusStore = useAgentStatusStore();
  const bridleStore = useBridleStore();

  onMounted(() => statusStore.connect());
  onBeforeUnmount(() => statusStore.disconnect());

  const transitioning = computed(
    () =>
      requestInFlight.value ||
      (agent.value ? TRANSITIONAL.has(agent.value.status) : false),
  );
  const failed = computed(() =>
    agent.value ? FAILED.has(agent.value.status) : false,
  );

  // The hub's word from either side: the stream names every agent, an open
  // chat hears its own agent first.
  const hubConnected = computed(
    () =>
      statusStore.hub[agentId] === true ||
      bridleStore.agentOnlineFor(agentId) === true,
  );

  // What this launch is, between the click and the server's answer. After
  // that the agent's own `launchContext` says it, for everybody.
  const pendingKind = ref<LaunchKind | null>(null);
  /** Call before the status is flipped: the server's own rule, guessed. */
  function expectLaunch(statusBefore: string) {
    pendingKind.value =
      statusBefore === 'stopped' || statusBefore === 'failed' ? 'start' : 'restart';
  }
  watch(requestInFlight, (inFlight) => {
    if (!inFlight) pendingKind.value = null;
  });

  const inLaunch = ref(false);
  const seq = ref(0);
  // The furthest step an earlier reading of THIS launch proved. Facts flicker
  // (a pod frame goes missing between two events); the list does not go back.
  const floor = ref(-1);
  // The instance that was there before this launch has left the hub.
  const wentDown = ref(false);
  const hold = ref(false);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  watch(hubConnected, (up) => {
    if (!up && inLaunch.value) wentDown.value = true;
  });

  const facts = computed<LaunchFacts | null>(() => {
    const row = agent.value;
    if (!row) return null;
    // In this console the chat is usable as soon as the agent reads
    // `running`: that is when the overlay has always cleared. So `running`
    // is the proof of the last steps here, and nothing waits on a hub word
    // that might arrive a moment later.
    const settled = row.status === 'running' && !requestInFlight.value;
    return {
      kind: pendingKind.value ?? row.launchContext ?? 'start',
      requestInFlight: requestInFlight.value,
      status: row.status,
      statusReason: row.statusReason,
      pod: statusStore.pods[agentId] ?? null,
      hubConnected: hubConnected.value || settled,
      wentDown: wentDown.value || settled,
      // The tool servers have their own line in this console's chat.
      tools: null,
      floor: floor.value,
    };
  });

  const view = computed<LaunchView | null>(() =>
    facts.value ? deriveLaunch(facts.value) : null,
  );
  watch(
    () => view.value?.reached ?? -1,
    (reached) => {
      if (inLaunch.value && reached > floor.value) floor.value = reached;
    },
  );

  watch(
    () => [transitioning.value, failed.value] as const,
    ([active, isFailed], previous) => {
      const wasActive = previous?.[0] ?? false;
      if (active) {
        if (wasActive && inLaunch.value) return;
        inLaunch.value = true;
        seq.value += 1;
        floor.value = -1;
        hold.value = false;
        if (holdTimer) clearTimeout(holdTimer);
        // If the runtime is on the hub right now, it is the old instance.
        wentDown.value = !hubConnected.value;
        return;
      }
      if (!inLaunch.value) return;
      if (isFailed) {
        // The list stays, stopped on its step. The reason is on the row,
        // which nothing polls any more now that the launch is over.
        void agentStore.fetchById(agentId).catch(() => {});
        return;
      }
      if (wasActive && view.value?.outcome === 'ready') {
        hold.value = true;
        holdTimer = setTimeout(() => {
          hold.value = false;
        }, LAUNCH_DONE_HOLD_MS);
      }
      inLaunch.value = false;
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (holdTimer) clearTimeout(holdTimer);
  });

  /** The list is on screen: a launch under way, just completed, or failed. */
  const visible = computed(
    () =>
      Boolean(agent.value) &&
      (transitioning.value || hold.value || (inLaunch.value && failed.value)),
  );

  const launch = computed<IAgentLaunch | null>(() =>
    view.value
      ? {
          view: view.value,
          seq: seq.value,
          // 'idle' and 'connecting' are a page that just opened, not a loss.
          stale: statusStore.connectionState === 'disconnected',
        }
      : null,
  );

  return { launch, visible, transitioning, expectLaunch };
}
