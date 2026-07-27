import type { Ref } from 'vue';
import type { IAgentData, AgentStatusTypes } from '#agent/domain';

export type ChatOverlay =
  | { kind: 'starting'; title: string; detail: string }
  | { kind: 'failed'; title: string; detail: string }
  | { kind: 'stopped'; title: string; detail: string }
  | null;

// Statuses that consume cluster resources (a pod is or will be running) — the
// only states where "Stop" makes sense. Everything else gets "Start".
const RESOURCE_HOLDING: ReadonlySet<AgentStatusTypes> = new Set([
  'running',
  'deploying',
  'pending',
]);

const POLL_STATUSES: ReadonlySet<AgentStatusTypes> = new Set([
  'pending',
  'deploying',
]);

/**
 * Runtime lifecycle of a single agent: restart / stop / start with optimistic
 * status flips, the pending-restart banner, live pod state from the SSE
 * stream, status polling while deploying, and the chat-overlay state derived
 * from all of the above. Owns the SSE connection and its timers — everything
 * stops when the calling component unmounts.
 */
export function useAgentLifecycle(
  agentId: string,
  agent: Ref<IAgentData | null | undefined>,
  refresh: () => Promise<unknown>,
) {
  const agentStore = useAgentStore();
  const agentStatusStore = useAgentStatusStore();
  const bridleStore = useBridleStore();

  // ── Live pod state from SSE ──────────────────────────────────────────
  // Lets the user watch sub-second pod transitions (Pending →
  // ContainerCreating → Running) instead of waiting on the 5s status poll.
  onMounted(() => agentStatusStore.connect());
  onBeforeUnmount(() => agentStatusStore.disconnect());

  const podStatus = computed(() => agentStatusStore.statuses[agentId] ?? null);
  const podLabel = computed(() => podPhaseLabel(podStatus.value));

  // ── Restart ──────────────────────────────────────────────────────────
  const restarting = ref(false);
  const restartError = ref<string | null>(null);

  // Busy while the API call is in flight AND while the pod is still coming up
  // (status='deploying'). Reverts to idle once the AgentStatusService
  // reconciler flips the agent to 'running'.
  const isRestarting = computed(
    () => restarting.value || agent.value?.status === 'deploying',
  );

  async function restart() {
    if (!agent.value || isRestarting.value) return;
    restarting.value = true;
    restartError.value = null;
    // Persist BEFORE the API call so an F5 in the next 1–3 sec (while the
    // server is still cancelling the old workflow and hasn't yet written
    // status='deploying') still shows the overlay.
    agentStore.markRestartInFlight(agentId);
    // Optimistic — flip to "deploying" right away so the badge reacts before
    // the API call resolves (cancel + submit takes a few seconds).
    const previousStatus = agent.value.status;
    agent.value = { ...agent.value, status: 'deploying' };
    try {
      await agentStore.restart(agentId);
      agentStore.clearPendingRestart(agentId);
      await refresh();
    } catch (err) {
      if (agent.value) agent.value = { ...agent.value, status: previousStatus };
      agentStore.clearRestartInFlight(agentId);
      restartError.value = (err as Error).message || 'Restart failed';
    } finally {
      restarting.value = false;
    }
  }

  // ── Stop / Start ─────────────────────────────────────────────────────
  // Stop cancels the workflow and deletes the pod to free cluster CPU/memory
  // (so another agent can start when the cluster is full); Start deploys a
  // fresh pod. Which one we show depends on whether the agent holds a pod.
  const canStop = computed(() =>
    agent.value ? RESOURCE_HOLDING.has(agent.value.status) : false,
  );
  const toggling = ref(false);
  const toggleError = ref<string | null>(null);

  async function toggleRunning() {
    if (!agent.value || toggling.value) return;
    toggling.value = true;
    toggleError.value = null;
    const previousStatus = agent.value.status;
    const stopping = canStop.value;
    // Optimistic flip so the badge reacts before the API resolves.
    agent.value = {
      ...agent.value,
      status: stopping ? 'stopped' : 'deploying',
    };
    try {
      if (stopping) {
        await agentStore.stop(agentId);
      } else {
        agentStore.markRestartInFlight(agentId);
        await agentStore.start(agentId);
      }
      await refresh();
    } catch (err) {
      if (agent.value) agent.value = { ...agent.value, status: previousStatus };
      if (!stopping) agentStore.clearRestartInFlight(agentId);
      toggleError.value =
        (err as Error).message || (stopping ? 'Stop failed' : 'Start failed');
    } finally {
      toggling.value = false;
    }
  }

  // ── Pending-restart banner ───────────────────────────────────────────
  const pendingRestart = computed(() => agentStore.isPendingRestart(agentId));
  const dismissRestartBanner = () => agentStore.clearPendingRestart(agentId);

  // ── Status polling while deploying ───────────────────────────────────
  // Backend syncStatus runs on each fetchById; refreshing pulls the latest
  // workflow phase. Stops as soon as the agent reaches a terminal state.
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  watch(
    () => agent.value?.status,
    (status) => {
      if (status && POLL_STATUSES.has(status)) {
        if (!statusTimer) statusTimer = setInterval(refresh, 5000);
      } else if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (statusTimer) clearInterval(statusTimer);
  });

  // ── Chat overlay ─────────────────────────────────────────────────────
  // Combined "agent is not ready for chat" state. Falls out of the reconciled
  // DB status plus the live pod readiness flag (the same two signals
  // AgentStatusService merges) — gives the user a clear "starting…"
  // indication during the seconds-long gap between Restart click and the chat
  // WS reconnecting. Null when chat is fully usable.
  const chatOverlay = computed<ChatOverlay>(() => {
    if (!agent.value) return null;
    const s = agent.value.status;
    const pod = podStatus.value;
    // localStorage-backed — survives F5 during the seconds-long window
    // between Restart click and the API writing status='deploying'.
    const inFlight = agentStore.isRestartInFlight(agentId);
    // Strongest "agent is up" signal: chat WS is connected AND the runtime is
    // registered with the hub. This bypasses DB/pod entirely — if the agent
    // is actually talking to us, nothing else matters.
    const chatLive = bridleStore.isConnected && bridleStore.isAgentConnected;

    if (chatLive) return null;

    if (s === 'stopped') {
      return {
        kind: 'stopped',
        title: 'Agent stopped',
        detail:
          'The pod was deleted to free cluster resources. Start it to chat again.',
      };
    }

    if (s === 'failed') {
      return {
        kind: 'failed',
        title: 'Agent failed to start',
        detail:
          pod?.message ??
          pod?.containerWaitingReason ??
          'Pod did not come up. Check logs and restart.',
      };
    }

    if (s === 'pending' || s === 'deploying' || inFlight) {
      return {
        kind: 'starting',
        title: 'Starting agent…',
        detail: pod
          ? `Pod ${pod.podName}: ${podLabel.value ?? pod.phase}`
          : 'Cancelling old workflow and submitting a fresh one.',
      };
    }

    // status='running' but pod still not Ready — brief window right after the
    // reconciler flipped the DB but before the readiness probe passes.
    if (s === 'running' && pod && !pod.ready) {
      return {
        kind: 'starting',
        title: 'Starting agent…',
        detail: podLabel.value ?? 'Waiting for container readiness',
      };
    }

    return null;
  });

  // Clear the persisted in-flight flag once we have ANY confirmation the
  // agent is back: bridle chat live, status=running+pod ready, or terminal
  // failure. Bridle is the primary trigger — it fires before the K8s probe
  // can pass.
  watch(
    () =>
      [
        agent.value?.status,
        podStatus.value?.ready,
        bridleStore.isConnected,
        bridleStore.isAgentConnected,
      ] as const,
    ([status, ready, chatConnected, agentConnected]) => {
      const chatLive = chatConnected && agentConnected;
      if (chatLive || (status === 'running' && ready === true)) {
        agentStore.clearRestartInFlight(agentId);
      } else if (status === 'failed') {
        agentStore.clearRestartInFlight(agentId);
      }
    },
  );

  return {
    podStatus,
    podLabel,
    restarting,
    isRestarting,
    restartError,
    restart,
    canStop,
    toggling,
    toggleError,
    toggleRunning,
    pendingRestart,
    dismissRestartBanner,
    chatOverlay,
  };
}
