export type InstanceStateTypes =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopping';

export interface IInstanceStatus {
  knowledgeId: string;
  state: InstanceStateTypes;
  /** In-cluster base URL of this base's instance; null unless ready. */
  endpoint: string | null;
  error: string | null;
  observedAt: string;
}
