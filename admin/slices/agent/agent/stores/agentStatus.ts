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

  // Counted over the agents this account holds, not over every pod the
  // stream names (CLEAN-231): the stream is public and names every agent of
  // the installation, and a count that included the others would tell a
  // limited account how many agents it does not reach are failing.
  const failingCount = computed(
    () =>
      Object.entries(statuses.value).filter(
        ([id, s]) =>
          agentStore.byId(id) !== undefined &&
          (s.phase === 'Failed' ||
            s.containerWaitingReason === 'CrashLoopBackOff' ||
            s.containerWaitingReason === 'ImagePullBackOff' ||
            s.containerWaitingReason === 'ErrImagePull'),
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
  // Agents the stream names and GET /agents did not return to this account:
  // ones it does not reach (CLEAN-231). Their rows are never asked for (the
  // API answers 404), and they do not make the collection look stale. An id
  // leaves this set by turning up in the collection, on any later list read.
  const notOurs = new Set<string>();
  // Bumped by `resetForAccount`: a list read for the previous account says
  // nothing about what the next one reaches.
  let accountGeneration = 0;

  // The list, read because the stream named something the store does not
  // hold. Whatever the stream named that is still missing afterwards is not
  // this account's.
  async function readList(named: string[]) {
    const generation = accountGeneration;
    try {
      await agentStore.fetchAll();
    } catch {
      // Refused or unreachable: nothing was learned, the next frame asks.
      return;
    }
    if (generation !== accountGeneration) return;
    for (const id of named) {
      if (!agentStore.byId(id)) notOurs.add(id);
    }
  }

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
    // The row is behind a token. With nobody signed in there is nobody to
    // read it for: the stream outlives a sign-out by a moment (CLEAN-231).
    if (!useAuthStore().isAuthenticated) return;
    // An agent the store has never held is found through the list, not by
    // id: for one this account does not reach, GET /agents/:id answers 404,
    // and the list simply does not have it (CLEAN-231). Asked once per id.
    if (!agentStore.byId(id)) {
      if (notOurs.has(id)) return;
      reading.add(id);
      try {
        await readList([id]);
      } finally {
        reading.delete(id);
      }
      return;
    }
    reading.add(id);
    try {
      for (let i = 0; i < 3; i += 1) {
        // No row back: gone, or not this account's any more. Asking again
        // would be answered the same way.
        if (!(await agentStore.fetchById(id))) break;
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
      // GET /agents loads it, as it does on a page load. Agents already
      // known not to be this account's are left out of the comparison:
      // they would make the collection look stale on every snapshot.
      const frames = msg.payload
        .map((item) => item.agent)
        .filter((a) => agentStore.byId(a.id) || !notOurs.has(a.id));
      if (
        useAuthStore().isAuthenticated &&
        collectionIsStale(agentStore.agents, frames)
      ) {
        void readList(frames.map((a) => a.id));
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

  // Whoever was signed in is not any more (CLEAN-231): what the stream said
  // while they were is dropped, the rows it remembered included. The stream
  // itself belongs to the components that subscribed and is left to them;
  // its next frame fills this again for whoever is signed in then. The ONE
  // way this store is emptied for an account change (docs/state.md).
  function resetForAccount() {
    accountGeneration += 1;
    statuses.value = {};
    bridleConnected.value = {};
    lastEventAt.value = null;
    lastSeen.clear();
    reading.clear();
    notOurs.clear();
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
    resetForAccount,
    connect,
    disconnect,
  };
});
