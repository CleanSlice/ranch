import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentStatusService } from '#agent/domain';
import type {
  AgentStatusStreamMessage,
  ConnectionStateTypes,
  IAgentPodStatus,
  IAgentRecord,
} from '#agent/domain';
import { collectionIsStale, rowIsStale } from '#agent/utils/agentStatusFrame';

// Re-export the domain types so any consumer importing them from
// `#agent/stores/agentStatus` keeps working.
export type {
  ConnectionStateTypes,
  IAgentPodStatus,
  IAgentRecord,
  IAgentStatus,
} from '#agent/domain';

const getService = createServiceGetter<AgentStatusService>('$agentStatusService');

export const useAgentStatusStore = defineStore('agentStatus', () => {
  const connectionState = ref<ConnectionStateTypes>('idle');
  const lastEventAt = ref<number | null>(null);
  const statuses = ref<Record<string, IAgentPodStatus>>({});
  // No `agents` map here on purpose (docs/state.md): the status a frame
  // carries is patched into the agent store, the one place an agent lives.
  // This store keeps only what exists nowhere else — pod state and hub
  // connectivity.
  const agentStore = useAgentStore();
  // Live hub connectivity per agent — pushed with every snapshot/event.
  const bridleConnected = ref<Record<string, boolean>>({});

  // Consumer ref-count: multiple components mount/unmount the stream, but only
  // one EventSource should be open. `active` guards the single subscribe.
  let subscribers = 0;
  let active = false;

  const connected = computed(() => connectionState.value === 'connected');

  const failingCount = computed(
    () =>
      Object.values(statuses.value).filter(
        (s) =>
          s.phase === 'Failed' ||
          s.containerWaitingReason === 'CrashLoopBackOff' ||
          s.containerWaitingReason === 'ImagePullBackOff' ||
          s.containerWaitingReason === 'ErrImagePull',
      ).length,
  );

  // Agents whose pod is healthy but whose runtime never registered on the
  // bridle hub — as alarming as a failing pod, surfaced the same way.
  const unreachableCount = computed(
    () =>
      agentStore.agents.filter((a) => a.status === 'unreachable').length,
  );

  // The stream is public and carries status facts only (CLEAN-232): a frame
  // patches the status of the record the agent store holds and never
  // replaces it. The row itself (name, configuration, the reason of a
  // failure) is read through the authenticated route, when a frame shows the
  // record is stale or names an agent the store has never held.
  const lastSeen = new Map<string, IAgentRecord>();
  const reading = new Set<string>();

  function patchStatus(frame: IAgentRecord) {
    const known = agentStore.byId(frame.id);
    if (known && known.status !== frame.status) {
      agentStore.patch(frame.id, { status: frame.status });
    }
  }

  // One read per agent at a time. A frame that lands while it is in flight
  // is remembered, and the row is read once more if it is still behind.
  async function readRow(id: string) {
    if (reading.has(id)) return;
    reading.add(id);
    try {
      for (let i = 0; i < 3; i += 1) {
        await agentStore.fetchById(id);
        const seen = lastSeen.get(id);
        if (!seen || !rowIsStale(agentStore.byId(id), seen)) break;
      }
    } catch {
      // Gone, or not ours to read: the status the frame carried stands.
    } finally {
      reading.delete(id);
    }
  }

  function applyMessage(msg: AgentStatusStreamMessage) {
    lastEventAt.value = Date.now();
    if (msg.type === 'snapshot') {
      const nextStatuses: Record<string, IAgentPodStatus> = {};
      const nextBridle: Record<string, boolean> = {};
      for (const item of msg.payload) {
        if (item.pod) nextStatuses[item.agent.id] = item.pod;
        nextBridle[item.agent.id] = item.bridleConnected;
        lastSeen.set(item.agent.id, item.agent);
        patchStatus(item.agent);
      }
      statuses.value = nextStatuses;
      bridleConnected.value = nextBridle;
      // The snapshot names every agent. When the collection is not that list
      // (a new agent, a changed row, one deleted while the stream was down),
      // GET /agents loads it, as it does on a page load.
      if (
        collectionIsStale(
          agentStore.agents,
          msg.payload.map((item) => item.agent),
        )
      ) {
        void agentStore.fetchAll().catch(() => undefined);
      }
      return;
    }

    const { eventType, status } = msg.payload;
    // `deleted` is about the POD (restart, stop, TTL) — the agent is still
    // there, so the record stays.
    lastSeen.set(status.agent.id, status.agent);
    patchStatus(status.agent);
    if (rowIsStale(agentStore.byId(status.agent.id), status.agent)) {
      void readRow(status.agent.id);
    }
    bridleConnected.value = {
      ...bridleConnected.value,
      [status.agent.id]: status.bridleConnected,
    };

    if (eventType === 'deleted' || !status.pod) {
      const next = { ...statuses.value };
      delete next[status.agent.id];
      statuses.value = next;
    } else {
      statuses.value = { ...statuses.value, [status.agent.id]: status.pod };
    }
  }

  function connect() {
    subscribers += 1;
    if (active || !import.meta.client) return;
    active = true;
    getService().subscribe({
      onMessage: applyMessage,
      onConnectionStateChange: (state) => {
        connectionState.value = state;
      },
    });
  }

  function disconnect() {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers > 0 || !active) return;
    active = false;
    getService().unsubscribe();
    connectionState.value = 'idle';
  }

  return {
    connectionState,
    connected,
    lastEventAt,
    statuses,
    bridleConnected,
    failingCount,
    unreachableCount,
    connect,
    disconnect,
  };
});
