import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentStatusService } from '#agent/domain';
import type {
  AgentStatusStreamMessage,
  ConnectionStateTypes,
  IAgentPodStatus,
  IAgentRecord,
} from '#agent/domain';

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
  const agents = ref<Record<string, IAgentRecord>>({});

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

  function applyMessage(msg: AgentStatusStreamMessage) {
    lastEventAt.value = Date.now();
    if (msg.type === 'snapshot') {
      const nextAgents: Record<string, IAgentRecord> = {};
      const nextStatuses: Record<string, IAgentPodStatus> = {};
      for (const item of msg.payload) {
        nextAgents[item.agent.id] = item.agent;
        if (item.pod) nextStatuses[item.agent.id] = item.pod;
      }
      agents.value = nextAgents;
      statuses.value = nextStatuses;
      return;
    }

    const { eventType, status } = msg.payload;
    agents.value = { ...agents.value, [status.agent.id]: status.agent };

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
    agents,
    failingCount,
    connect,
    disconnect,
  };
});
