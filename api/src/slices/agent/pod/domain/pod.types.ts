export type PodPhaseTypes =
  | 'Pending'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown';

export interface IAgentPodStatus {
  agentId: string;
  podName: string;
  phase: PodPhaseTypes;
  ready: boolean;
  restartCount: number;
  startedAt: string | null;
  /**
   * The pod has been asked to go away (`metadata.deletionTimestamp` is set):
   * a restart's cleanup step, a stop, a manual delete. Its containers exiting
   * — and the phase turning Succeeded/Failed on the way out — is the delete
   * working, not an agent that failed (CLEAN-106).
   */
  terminating: boolean;
  lastTerminationReason: string | null;
  containerWaitingReason: string | null;
  message: string | null;
  observedAt: string;
}

export type PodEventTypes = 'added' | 'modified' | 'deleted';

export interface IAgentPodEvent {
  type: PodEventTypes;
  status: IAgentPodStatus;
}

export interface IAgentMetrics {
  pod: {
    cpuMilli: number;
    memBytes: number;
    cpuLimitMilli: number;
    memLimitBytes: number;
  };
  node: {
    name: string;
    diskAvailBytes: number;
    diskCapacityBytes: number;
  };
}

// What one "agent slot" costs the scheduler — the fixed requests floor every
// agent pod gets (Burstable QoS; limits vary per agent, requests never do).
// agent-workflow.manifest.ts builds its requests block from these constants.
export const AGENT_SLOT_CPU_MILLI = 100;
export const AGENT_SLOT_MEM_BYTES = 512 * 1024 * 1024;

export interface INodeCapacity {
  name: string;
  freeCpuMilli: number;
  freeMemBytes: number;
  freeSlots: number;
}

export interface IClusterCapacity {
  freeAgentSlots: number;
  usedAgentSlots: number;
  totalAgentSlots: number;
  slotCpuMilli: number;
  slotMemBytes: number;
  nodes: INodeCapacity[];
  observedAt: string;
}
