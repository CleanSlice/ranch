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
