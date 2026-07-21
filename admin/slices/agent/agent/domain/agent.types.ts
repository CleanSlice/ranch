// Domain types for the admin agent slice. Envelope-free; the data layer maps
// the (loosely-typed `unknown`) API responses onto these and converts domain
// input payloads to the wire DTOs.

export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

export interface IAgentResources {
  cpu: string;
  memory: string;
}

export interface IAgentMetrics {
  pod: {
    cpuMilli: number;
    memBytes: number;
    cpuLimitMilli: number;
    memLimitBytes: number;
  };
  node: {
    name: string;
    diskAvailBytes: number;
    diskCapacityBytes: number;
  };
}

export interface IAgentEnvVar {
  name: string;
  value: string;
}

export interface IAgentData {
  id: string;
  name: string;
  templateId: string;
  llmCredentialId: string | null;
  status: AgentStatusTypes;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  isPublic: boolean;
  allowedOrigins: string[];
  knowledgeIds: string[];
  isAdmin: boolean;
  debugEnabled: boolean;
  createdAt: string;
  updatedAt: string;
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
  isAdmin?: boolean;
}

export interface IUpdateAgentData {
  name?: string;
  templateId?: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
  debugEnabled?: boolean;
}
