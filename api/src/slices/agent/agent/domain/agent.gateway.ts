import {
  IAgentData,
  ICreateAgentData,
  IUpdateAgentData,
  AgentStatusTypes,
  LaunchContextTypes,
} from './agent.types';

export abstract class IAgentGateway {
  abstract findAll(): Promise<IAgentData[]>;
  abstract findPublic(): Promise<IAgentData[]>;
  abstract findAdmin(): Promise<IAgentData | null>;
  abstract findById(id: string): Promise<IAgentData | null>;
  abstract findByTemplateId(templateId: string): Promise<IAgentData[]>;
  abstract create(data: ICreateAgentData): Promise<IAgentData>;
  abstract update(id: string, data: IUpdateAgentData): Promise<IAgentData>;
  abstract updateStatus(
    id: string,
    status: AgentStatusTypes,
    workflowId?: string | null,
    statusReason?: string,
  ): Promise<IAgentData>;
  // Reason-only write: status untouched. Used by the deploy path to flag
  // empty bridle settings while the row is still 'deploying'.
  abstract setStatusReason(id: string, reason: string): Promise<void>;
  // Atomic deploy-start write: status='deploying', statusReason cleared,
  // lastDeployStartedAt=now, lastLaunchContext=<given>.
  abstract markDeployStarted(
    id: string,
    launchContext: LaunchContextTypes,
  ): Promise<IAgentData>;
  // Sets firstDeployedAt=now only if it is still null (set-once semantics).
  abstract setFirstDeployedAt(id: string): Promise<void>;
  // Sync-conflict markers: pod's boot pull (recorded at bridle connect) and
  // last completed Sync push. Non-throwing on missing agents — both fire from
  // async event paths that must not fail the surrounding flow.
  // `at` overrides "now" when the actual boot moment is known (pod startedAt).
  abstract setLastPullAt(id: string, at?: Date): Promise<void>;
  abstract setLastSyncAt(id: string): Promise<void>;
  // null detaches the current workflow (used by restart before cancelling
  // the old one, so status pollers can't resolve its terminal phase).
  abstract setWorkflowId(
    id: string,
    workflowId: string | null,
  ): Promise<IAgentData>;
  abstract setAdmin(id: string, enabled: boolean): Promise<IAgentData>;
  abstract delete(id: string): Promise<void>;
}
