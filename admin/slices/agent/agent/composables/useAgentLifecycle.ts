import type { Ref } from 'vue';
import type { IAgentData, AgentStatusTypes } from '#agent/domain';
import { useAgentToolState } from '#agent/composables/useAgentToolState';
import {
  deriveLaunch,
  type LaunchFacts,
  type LaunchKind,
  type LaunchView,
} from '#agent/utils/launchSteps';

/** A launch as the overlay shows it: the step list, in place of a spinner
 *  and a sentence (CLEAN-247). */
export interface IAgentLaunchOverlay {
  view: LaunchView;
  /** Changes with every new launch of this agent: the list starts over. */
  seq: number;
  /** The status stream is not connected: the list is its last known state. */
  stale: boolean;
  /** What the last step is waiting for (the tool servers), when it is. */
  readyNote: string | null;
}

export type ChatOverlay =
  | {
      kind: 'starting';
      title: string;
      detail: string;
      launch?: IAgentLaunchOverlay;
    }
  // `launch` is there when the failure ended a launch this page was showing:
  // the list then stops on the step that failed.
  | {
      kind: 'failed';
      title: string;
      detail: string;
      launch?: IAgentLaunchOverlay;
    }
  | { kind: 'stopped'; title: string; detail: string }
  // The agent is up and on the hub, still reaching its tool servers
  // (CLEAN-245). Not a restart: nothing is being recreated.
  | { kind: 'tools'; title: string; detail: string }
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

// How long the completed step list stays before the chat shows through: long
// enough to read its last line, short enough not to delay the first message
// (which the queue sends on its own anyway).
const LAUNCH_DONE_HOLD_MS = 1200;

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
  // The page's one reader of the tool-server detail; the header dot, the chat
  // line and Overview render what it leaves in the status store.
  const { toolView } = useAgentToolState(agentId, agent, { poll: true });
  const podLabel = computed(() => podPhaseLabel(podStatus.value));

  // ── Restart ──────────────────────────────────────────────────────────
  const restarting = ref(false);
  const restartError = ref<string | null>(null);

  // The old pod's chat WS stays connected for a few seconds after the restart
  // call — "agent is connected" alone can't tell the dying pod from the fresh
  // one. A restart only counts as finished once the agent has actually gone
  // DOWN and come back (or the reconciled status confirms running/failed).
  const agentWentDown = ref(false);
  // A launch this page is showing, whoever started it (CLEAN-247): a restart
  // somebody else pressed has an old instance to wait out as well.
  const inLaunch = ref(false);
  watch(
    () => bridleStore.isAgentConnectedFor(agentId),
    (up) => {
      if (
        !up &&
        (restarting.value ||
          agentStore.isRestartInFlight(agentId) ||
          inLaunch.value)
      ) {
        agentWentDown.value = true;
      }
    },
  );
  // What this launch is, between the click and the server's answer. After
  // that the agent's own `launchContext` says it, for everybody.
  const pendingKind = ref<LaunchKind | null>(null);
  // The server's rule (agentDeploy.service): no instance to replace → start.
  const guessKind = (status: AgentStatusTypes): LaunchKind =>
    status === 'stopped' || status === 'failed' ? 'start' : 'restart';

  // Busy while the API call is in flight AND while the pod is still coming up
  // (status='deploying'). Reverts to idle once the AgentStatusService
  // reconciler flips the agent to 'running'.
  const isRestarting = computed(
    () => restarting.value || agent.value?.status === 'deploying',
  );

  async function restart() {
    if (!agent.value || isRestarting.value) return;
    // Read before anything flips the status optimistically.
    pendingKind.value = guessKind(agent.value.status);
    restarting.value = true;
    restartError.value = null;
    // Persist BEFORE the API call so an F5 in the next 1–3 sec (while the
    // server is still cancelling the old workflow and hasn't yet written
    // status='deploying') still shows the overlay.
    agentStore.markRestartInFlight(agentId);
    // Restarting a dead pod skips the "goes down" phase — it's already down.
    agentWentDown.value = !bridleStore.isAgentConnectedFor(agentId);
    // The optimistic "deploying" flip (and its rollback on error) happens
    // inside `agentStore.restart`, on the one store record `agent` is read
    // from — so the rail row flips together with this header.
    try {
      await agentStore.restart(agentId);
      agentStore.clearPendingRestart(agentId);
      await refresh();
    } catch (err) {
      agentStore.clearRestartInFlight(agentId);
      restartError.value = (err as Error).message || 'Restart failed';
    } finally {
      restarting.value = false;
      pendingKind.value = null;
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
    // Read before the call: the store's optimistic flip changes `canStop`.
    const stopping = canStop.value;
    try {
      if (stopping) {
        await agentStore.stop(agentId);
      } else {
        agentStore.markRestartInFlight(agentId);
        // Starting from stopped/failed: there is no old pod to go down.
        agentWentDown.value = true;
        pendingKind.value = 'start';
        await agentStore.start(agentId);
      }
      await refresh();
    } catch (err) {
      if (!stopping) agentStore.clearRestartInFlight(agentId);
      toggleError.value =
        (err as Error).message || (stopping ? 'Stop failed' : 'Start failed');
    } finally {
      toggling.value = false;
      pendingKind.value = null;
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
  // Each refresh replaces the store record, which re-runs the computeds (fresh
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
  // This is the state alone; `chatOverlay` below adds the launch step list.
  const rawOverlay = computed<ChatOverlay>(() => {
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
        // The pod's name is no longer on the public status stream
        // (CLEAN-232); its state is what this line is for.
        detail: freshPod
          ? `Pod: ${podLabel.value ?? freshPod.phase}`
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
    const chatLive =
      bridleStore.isConnectedFor(agentId) &&
      bridleStore.isAgentConnectedFor(agentId);

    if (chatLive) {
      // On the hub but not ready for work yet: say what the wait is for, so
      // a start that takes a minute longer does not read as a hang.
      const tools = toolView.value;
      if (tools?.kind === 'connecting') {
        return { kind: 'tools', title: tools.label, detail: tools.detail };
      }
      return null;
    }

    if (s === 'failed') {
      return {
        kind: 'failed',
        title: 'Agent failed to start',
        // Server-side statusReason is the authoritative cause (startup
        // timeout, ImagePullBackOff, workflow submit error, …); the pod's
        // waiting reason is the fallback for failures recorded before it
        // existed. The pod's Kubernetes message is no longer on the public
        // status stream (CLEAN-232).
        detail:
          agent.value.statusReason ??
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

  // ── Launch steps (CLEAN-247) ─────────────────────────────────────────
  // The same facts the overlay above folds into one sentence, kept apart: a
  // launch is a list of steps, each done because a fact proves it. The
  // derivation is `launchSteps.ts`; this is only the wiring and the memory a
  // pure function cannot have.
  const launchSeq = ref(0);
  // The furthest step an earlier reading of THIS launch proved. Facts flicker
  // (a pod frame goes missing between two events); the list does not go back.
  const launchFloor = ref(-1);
  const launchHold = ref(false);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const launchFacts = computed<LaunchFacts | null>(() => {
    if (!agent.value) return null;
    const pod = podStatus.value;
    return {
      kind: pendingKind.value ?? agent.value.launchContext ?? 'start',
      requestInFlight: restarting.value || toggling.value,
      status: agent.value.status,
      statusReason: agent.value.statusReason ?? null,
      pod: pod
        ? {
            phase: pod.phase,
            ready: pod.ready,
            containerWaitingReason: pod.containerWaitingReason,
            superseded: pod.superseded === true,
          }
        : null,
      // The same two signals that make the overlay above null: the list
      // must not say "ready" while the chat still cannot be used.
      hubConnected:
        bridleStore.isConnectedFor(agentId) &&
        bridleStore.isAgentConnectedFor(agentId),
      wentDown: agentWentDown.value,
      tools: toolView.value?.kind === 'connecting' ? 'connecting' : null,
      floor: launchFloor.value,
    };
  });
  const launchView = computed<LaunchView | null>(() =>
    launchFacts.value ? deriveLaunch(launchFacts.value) : null,
  );
  watch(
    () => launchView.value?.reached ?? -1,
    (reached) => {
      if (inLaunch.value && reached > launchFloor.value) {
        launchFloor.value = reached;
      }
    },
  );

  watch(
    () => rawOverlay.value?.kind ?? null,
    (kind, previous) => {
      if (kind === 'starting') {
        // 'tools' → 'starting' is the same launch seen again, not a new one.
        if (inLaunch.value && previous === 'tools') return;
        if (previous === 'starting') return;
        inLaunch.value = true;
        launchSeq.value += 1;
        launchFloor.value = -1;
        launchHold.value = false;
        if (holdTimer) clearTimeout(holdTimer);
        // A launch this page did not start: nobody set this. If the runtime
        // is on the hub right now it is the old instance still.
        if (!restarting.value && !toggling.value) {
          agentWentDown.value = !bridleStore.isAgentConnectedFor(agentId);
        }
        return;
      }
      // Tools still connecting is the last step's own wait; a failure keeps
      // the list up, stopped on its step.
      if (kind === 'tools' || kind === 'failed') return;
      if (inLaunch.value && kind === null && launchView.value?.outcome === 'ready') {
        launchHold.value = true;
        holdTimer = setTimeout(() => {
          launchHold.value = false;
        }, LAUNCH_DONE_HOLD_MS);
      }
      inLaunch.value = false;
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (holdTimer) clearTimeout(holdTimer);
  });

  const chatOverlay = computed<ChatOverlay>(() => {
    const raw = rawOverlay.value;
    const view = launchView.value;
    if (!view) return raw;
    const launch: IAgentLaunchOverlay = {
      view,
      seq: launchSeq.value,
      // 'idle' and 'connecting' are a page that has just opened, not a loss.
      stale: agentStatusStore.connectionState === 'disconnected',
      readyNote: raw?.kind === 'tools' ? raw.title : null,
    };
    // The completed list, for a moment, before the chat shows through.
    if (!raw) {
      return launchHold.value
        ? { kind: 'starting', title: 'Agent is ready', detail: '', launch }
        : null;
    }
    if (!inLaunch.value) return raw;
    if (raw.kind === 'starting' || raw.kind === 'failed') {
      return { ...raw, launch };
    }
    if (raw.kind === 'tools') {
      return { kind: 'starting', title: raw.title, detail: raw.detail, launch };
    }
    return raw;
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
        bridleStore.isConnectedFor(agentId),
        bridleStore.isAgentConnectedFor(agentId),
      ] as const,
    ([status, ready, chatConnected, agentConnected]) => {
      const chatLive = chatConnected && agentConnected;
      // `chatLive && status === 'running'` covers the post-F5 recovery:
      // `agentWentDown` resets on reload, and requiring it would leave the
      // flag stuck until the SSE ready signal. Premature-clear risk is only
      // the 1–2s window before the server writes 'deploying' — and even
      // then the status flip re-raises the overlay by itself.
      // `stopped` once this page's own call has been answered is a stop that
      // came from elsewhere (another tab, the agent's tool): the launch is
      // over. Without it the flag kept "starting" on screen for its whole
      // five-minute life, which with a step list reads as a hung launch
      // (CLEAN-247). While the call is out the row may still say `stopped`
      // from before a Start, so that does not count.
      const stoppedElsewhere =
        status === 'stopped' && !restarting.value && !toggling.value;
      if (
        (chatLive && (agentWentDown.value || status === 'running')) ||
        (status === 'running' && ready === true) ||
        status === 'failed' ||
        stoppedElsewhere
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
    toolView,
  };
}
