// Domain types for the admin agent slice. Envelope-free; the data layer maps
// the (loosely-typed `unknown`) API responses onto these and converts domain
// input payloads to the wire DTOs.

export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

/** Why the current/last deploy ran — server-derived, so the UI can tell a
 *  first start from a restart even after a page reload. */
export type LaunchContextTypes = 'initial' | 'restart';

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

/** Cluster headroom for new agents. `totalAgentSlots === 0` means the cluster
 *  has no schedulable agent nodes at all (e.g. local dev without the
 *  node-role=agents label) — distinct from "full". `null` end-to-end when the
 *  Kubernetes API is unreachable.
 *
 *  `maxNodeFree*` is the largest free CPU/memory chunk on a single agent node
 *  — the realistic ceiling for one agent's burst limits, since a pod lives on
 *  one node. `slot*` is the fixed request every agent pod reserves. */
export interface IClusterCapacityData {
  freeAgentSlots: number;
  usedAgentSlots: number;
  totalAgentSlots: number;
  slotCpuMilli: number;
  slotMemBytes: number;
  maxNodeFreeCpuMilli: number;
  maxNodeFreeMemBytes: number;
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
  /** Human-readable failure cause; non-null only while status is 'failed'
   *  (may still be null for failures recorded before the field existed). */
  statusReason: string | null;
  workflowId: string | null;
  /** Null ⇒ the agent has never been deployed. */
  firstDeployedAt: string | null;
  launchContext: LaunchContextTypes | null;
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
