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
