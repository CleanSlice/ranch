export interface IWorkflowStatus {
  name: string;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Error';
  startedAt: string | null;
  finishedAt: string | null;
}

/** A single env var as injected into an agent pod. */
export interface IAgentEnvVar {
  name: string;
  value: string;
}
