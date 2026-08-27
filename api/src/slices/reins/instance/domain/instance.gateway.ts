import { IInstanceStatus } from './instance.types';

export interface IProvisionInstanceData {
  knowledgeId: string;
  /** Label only, for humans reading the cluster. */
  knowledgeName: string;
  /** workspaceOf(knowledgeId) — the isolation namespace. */
  workspace: string;
}

export abstract class IInstanceGateway {
  /**
   * Refuses (409) with a stated reason when the cluster has no room for
   * another retrieval instance — the ceiling is reported before it is hit,
   * never discovered by degraded answers (FR-008).
   */
  abstract ensureCapacityForNew(): Promise<void>;
  /**
   * Idempotent: provisioning an existing, healthy instance is a no-op.
   * Called on base creation, on start-up reconciliation and by the
   * migration — none of those may create a second area for the same base.
   */
  abstract provision(data: IProvisionInstanceData): Promise<IInstanceStatus>;
  abstract status(knowledgeId: string): Promise<IInstanceStatus>;
  abstract list(): Promise<IInstanceStatus[]>;
  /** Removes the pod and its Service. Does not delete indexed content. */
  abstract terminate(knowledgeId: string): Promise<void>;
}
