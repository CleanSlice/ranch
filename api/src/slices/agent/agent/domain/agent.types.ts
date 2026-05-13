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
  llmCredentialId: string | null;
  status: AgentStatusTypes;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  debugEnabled: boolean;
  isPublic: boolean;
  allowedOrigins: string[];
  isAdmin: boolean;
  channels: IAgentChannel[];
  createdAt: Date;
  updatedAt: Date;
}

// Discriminated union — extend with `| { type: 'slack'; config: … }` etc.
// when adding new channel types. The runtime reads channel-specific env
// vars (TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN, …) — the workflow gateway
// flattens this shape into those env vars at submit time.
export type IAgentChannel = {
  type: 'telegram';
  config: {
    botToken: string;
    botName?: string;
    adminIds?: string;
  };
};

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
}

export interface IUpdateAgentData {
  name?: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  isPublic?: boolean;
  allowedOrigins?: string[];
}
