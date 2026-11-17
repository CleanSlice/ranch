// Domain types for the live agent-status stream (SSE). The data layer manages
// the EventSource transport and parses raw frames into these; the store applies
// them to reactive state.

import type { AgentStatusTypes } from './agent.types';

export type ConnectionStateTypes =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected';

// What the stream says of a pod: enough to draw a status dot. The pod's name
// and Kubernetes message are not sent to an anonymous reader (CLEAN-232).
export interface IAgentPodStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  ready: boolean;
  restartCount: number;
  containerWaitingReason: string | null;
}

// The stream is public (an EventSource cannot send a token), so a frame
// carries status facts only, never the agent's row (CLEAN-232): which agent,
// its status, and when its row last changed. The store patches the status
// into the one agent record and, when `updatedAt` shows that record is
// stale or the agent is new to it, reads the row through the authenticated
// route (docs/state.md).
export interface IAgentRecord {
  id: string;
  status: AgentStatusTypes;
  updatedAt: string;
}

export interface IAgentStatus {
  agent: IAgentRecord;
  pod: IAgentPodStatus | null;
  /** Live hub connectivity from the API process; false for a few seconds
   *  after an API restart until runtimes reconnect. */
  bridleConnected: boolean;
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
