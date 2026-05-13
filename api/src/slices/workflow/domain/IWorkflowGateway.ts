import { IWorkflowStatus } from './workflow.types';
import { IAgentChannel } from '#/agent/agent/domain';

export interface ISubmitWorkflowData {
  agentId: string;
  agentName: string;
  templateId: string;
  llmCredentialId: string | null;
  image: string;
  config: Record<string, unknown>;
  resources: { cpu: string; memory: string };
  isAdmin: boolean;
  ranchApiToken: string;
  channels: IAgentChannel[];
}

export abstract class IWorkflowGateway {
  abstract submit(data: ISubmitWorkflowData): Promise<string>;
  abstract cancel(workflowId: string): Promise<void>;
  abstract getStatus(workflowId: string): Promise<IWorkflowStatus>;
  abstract getLogs(workflowId: string): Promise<string>;
}
