export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

// Why the current/last deploy ran: 'initial' = first-ever deploy of this
// agent, 'restart' = any subsequent deploy (manual restart, start after stop,
// config-change redeploy). Server-derived so the UI can distinguish a first
// start from a restart even after a page reload.
export type LaunchContextTypes = 'initial' | 'restart';

export interface IAgentData {
  id: string;
  name: string;
  templateId: string;
  llmCredentialId: string | null;
  status: AgentStatusTypes;
  statusReason: string | null;
  workflowId: string | null;
  firstDeployedAt: Date | null;
  lastDeployStartedAt: Date | null;
  launchContext: LaunchContextTypes | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  debugEnabled: boolean;
  isPublic: boolean;
  allowedOrigins: string[];
  knowledgeIds: string[];
  isAdmin: boolean;
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
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
}

export interface IUpdateAgentData {
  name?: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
  debugEnabled?: boolean;
}
