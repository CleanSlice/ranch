export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped'
  // Pod is Running+Ready but the runtime never registered on the bridle hub
  // past the grace window — the agent looks alive to K8s yet can't serve chat.
  | 'unreachable';

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
  lastPullAt: Date | null;
  lastSyncAt: Date | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  debugEnabled: boolean;
  isPublic: boolean;
  allowedOrigins: string[];
  knowledgeIds: string[];
  isAdmin: boolean;
  /**
   * Pinned by the caller (CLEAN-231). Not a column: a pin is personal and
   * lives in AgentPin. The gateway reads every agent as not pinned; the
   * agent routes fill it in for the person asking.
   */
  pinned: boolean;
  /**
   * The console account that created the agent (CLEAN-232). Written once at
   * creation; null for a trusted party's agent and for agents older than the
   * column. A bare id: the account may be gone. Never sent to a client as is;
   * the controller resolves it into `createdBy` for Owner and Admin readers.
   */
  createdById: string | null;
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
  /**
   * Who is creating the agent: a console person's user id, never an
   * `agent:` subject. Null or absent for a trusted party. There is no
   * counterpart on `IUpdateAgentData`: the creator is never rewritten.
   */
  createdById?: string | null;
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
