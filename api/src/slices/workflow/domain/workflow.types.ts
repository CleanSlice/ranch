export interface IWorkflowStatus {
  name: string;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Error';
  startedAt: string | null;
  finishedAt: string | null;
}
