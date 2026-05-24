import { IWorkflowStatus, IAgentEnvVar } from './workflow.types';

export interface ISubmitWorkflowData {
  agentId: string;
  agentName: string;
  templateId: string;
  llmCredentialId: string | null;
  image: string;
  config: Record<string, unknown>;
  resources: { cpu: string; memory: string };
  isAdmin: boolean;
  debugEnabled: boolean;
  knowledgeIds: string[];
  ranchApiToken: string;
}

export abstract class IWorkflowGateway {
  abstract submit(data: ISubmitWorkflowData): Promise<string>;
  /** Env the pod would get on its next deploy — secrets masked. */
  abstract previewEnv(data: ISubmitWorkflowData): Promise<IAgentEnvVar[]>;
  abstract cancel(workflowId: string): Promise<void>;
  abstract getStatus(workflowId: string): Promise<IWorkflowStatus>;
  abstract getLogs(workflowId: string): Promise<string>;
}
