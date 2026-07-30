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

  // The old pod's chat WS stays connected for a few seconds after the restart
  // call — "agent is connected" alone can't tell the dying pod from the fresh
  // one. A restart only counts as finished once the agent has actually gone
  // DOWN and come back (or the reconciled status confirms running/failed).
  const agentWentDown = ref(false);
  watch(
    () => bridleStore.isAgentConnected,
    (up) => {
      if (!up && (restarting.value || agentStore.isRestartInFlight(agentId))) {
        agentWentDown.value = true;
      }
    },
  );

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
    // Restarting a dead pod skips the "goes down" phase — it's already down.
    agentWentDown.value = !bridleStore.isAgentConnected;
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
        // Starting from stopped/failed: there is no old pod to go down.
        agentWentDown.value = true;
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

  // ── Status polling while deploying or restart-in-flight ──────────────
  // Backend syncStatus runs on each fetchById; refreshing pulls the latest
  // workflow phase. Also polls while the persisted restart flag is set even
  // if the DB already says 'running': after a restart the server can report
  // 'running' while the pod is still being recreated (or is gone) — without
  // polling nothing reactive ever changes, the overlay computed freezes and
  // the flag's TTL never gets re-evaluated, pinning "restarting" forever.
  // Each refresh replaces the agent ref, which re-runs the computeds (fresh
  // Date.now() → TTL honored) and gives the server a chance to reconcile.
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  // While a lifecycle mutation (restart/stop/start) is awaiting its HTTP
  // response, a poll tick can resolve with the PRE-mutation status and
  // overwrite the optimistic 'deploying'/'stopped' flip wholesale. Skip
  // ticks for that window — the mutation handlers refresh() on completion.
  const pollTick = () => {
    if (restarting.value || toggling.value) return;
    void refresh();
  };
  watch(
    () => [agent.value?.status, agentStore.isRestartInFlight(agentId)] as const,
    ([status, inFlight]) => {
      if ((status && POLL_STATUSES.has(status)) || inFlight) {
        if (!statusTimer) statusTimer = setInterval(pollTick, 5000);
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
    const inFlight = restarting.value || agentStore.isRestartInFlight(agentId);

    // An explicit restart/deploy wins over the live-chat bypass below: the
    // OLD pod's WS stays connected for a few seconds after the restart call,
    // and reading that as "all good" hid the restart from the user entirely.
    if (inFlight || s === 'pending' || s === 'deploying') {
      // Pod info only describes the FRESH pod; while the old one is still
      // being torn down it would misleadingly read "Ready".
      const freshPod = pod && (agentWentDown.value || !inFlight) ? pod : null;
      // Server-derived launch context: a first-ever start reads "setting up",
      // anything else reads "starting" — so a fresh deploy no longer looks
      // like an update of something that already existed.
      const firstStart = agent.value.launchContext === 'initial';
      return {
        kind: 'starting',
        title: firstStart ? 'Setting up agent…' : 'Starting agent…',
        detail: freshPod
          ? `Pod ${freshPod.podName}: ${podLabel.value ?? freshPod.phase}`
          : firstStart
            ? 'First start — preparing the agent’s pod.'
            : 'Cancelling old workflow and submitting a fresh one.',
      };
    }

    // An explicit stop wins over the live-chat bypass below: the old
    // runtime's WS can linger after the pod delete (indefinitely on local
    // dev, where there is no pod to kill) — reading that as "all good" hid
    // the stopped state from the user entirely.
    if (s === 'stopped') {
      return {
        kind: 'stopped',
        title: 'Agent stopped',
        detail:
          'The pod was deleted to free cluster resources. Start it to chat again.',
      };
    }

    // Strongest "agent is up" signal: chat WS is connected AND the runtime is
    // registered with the hub. This bypasses DB/pod entirely — if the agent
    // is actually talking to us, nothing else matters.
    const chatLive = bridleStore.isConnected && bridleStore.isAgentConnected;

    if (chatLive) return null;

    if (s === 'failed') {
      return {
        kind: 'failed',
        title: 'Agent failed to start',
        // Server-side statusReason is the authoritative cause (startup
        // timeout, ImagePullBackOff, workflow submit error, …); live pod
        // details are the fallback for failures recorded before it existed.
        detail:
          agent.value.statusReason ??
          pod?.message ??
          pod?.containerWaitingReason ??
          'Pod did not come up. Check logs and restart.',
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

  // Clear the persisted in-flight flag once we have confirmation the agent is
  // back: bridle chat live (fastest — fires before the K8s probe passes, but
  // only counts after the agent actually went DOWN, else the old pod's
  // still-open WS clears the flag the instant Restart is clicked),
  // status=running+pod ready, or terminal failure.
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
      // `chatLive && status === 'running'` covers the post-F5 recovery:
      // `agentWentDown` resets on reload, and requiring it would leave the
      // flag stuck until the SSE ready signal. Premature-clear risk is only
      // the 1–2s window before the server writes 'deploying' — and even
      // then the status flip re-raises the overlay by itself.
      if (
        (chatLive && (agentWentDown.value || status === 'running')) ||
        (status === 'running' && ready === true) ||
        status === 'failed'
      ) {
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
