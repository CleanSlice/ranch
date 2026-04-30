export type ConnectionStateTypes = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface IAgentPodStatus {
  agentId: string;
  podName: string;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  ready: boolean;
  restartCount: number;
  startedAt: string | null;
  lastTerminationReason: string | null;
  containerWaitingReason: string | null;
  message: string | null;
  observedAt: string;
}

interface IAgentRecord {
  id: string;
  name: string;
  status: string;
}

interface IAgentStatus {
  agent: IAgentRecord;
  pod: IAgentPodStatus | null;
}

type StreamMessage =
  | { type: 'snapshot'; payload: IAgentStatus[] }
  | {
      type: 'event';
      payload: { eventType: 'added' | 'modified' | 'deleted'; status: IAgentStatus };
    };

export const useAgentStatusStore = defineStore('agentStatus', () => {
  const config = useRuntimeConfig();

  const connectionState = ref<ConnectionStateTypes>('idle');
  const lastEventAt = ref<number | null>(null);
  const statuses = ref<Record<string, IAgentPodStatus>>({});
  const agents = ref<Record<string, IAgentRecord>>({});

  let source: EventSource | null = null;
  let subscribers = 0;

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

  function applyMessage(msg: StreamMessage) {
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
    if (source || !import.meta.client) return;

    connectionState.value = 'connecting';
    const baseUrl = (config.public.apiUrl as string).replace(/\/$/, '');
    source = new EventSource(`${baseUrl}/agents/status/stream`);

    source.onopen = () => {
      connectionState.value = 'connected';
    };

    source.onmessage = (raw: MessageEvent) => {
      try {
        applyMessage(JSON.parse(raw.data) as StreamMessage);
      } catch (err) {
        // malformed payload — keep the connection but skip the message
        console.warn('[agentStatus] failed to parse SSE payload', err);
      }
    };

    source.onerror = () => {
      // EventSource handles reconnection on its own; reflect intermediate state
      connectionState.value = 'disconnected';
    };
  }

  function disconnect() {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers > 0 || !source) return;
    source.close();
    source = null;
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
