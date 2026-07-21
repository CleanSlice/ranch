// Domain types for the live agent-status stream (SSE). The data layer manages
// the EventSource transport and parses raw frames into these; the store applies
// them to reactive state.

export type ConnectionStateTypes =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected';

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

export interface IAgentRecord {
  id: string;
  name: string;
  status: string;
}

export interface IAgentStatus {
  agent: IAgentRecord;
  pod: IAgentPodStatus | null;
}

export type AgentStatusEventType = 'added' | 'modified' | 'deleted';

/** One decoded frame off the status stream: a full snapshot or a single delta. */
export type AgentStatusStreamMessage =
  | { type: 'snapshot'; payload: IAgentStatus[] }
  | {
      type: 'event';
      payload: { eventType: AgentStatusEventType; status: IAgentStatus };
    };

/** Callbacks the store hands to the subscription service. */
export interface IAgentStatusCallbacks {
  onMessage: (message: AgentStatusStreamMessage) => void;
  onConnectionStateChange: (state: ConnectionStateTypes) => void;
}
