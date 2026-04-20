export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

export interface IAgentData {
  id: string;
  name: string;
  templateId: string;
  status: AgentStatusTypes;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentResources {
  cpu: string;
  memory: string;
}

export interface ICreateAgentData {
  name: string;
  templateId: string;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
}

export interface IUpdateAgentData {
  name?: string;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
}
