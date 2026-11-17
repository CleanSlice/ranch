// Domain types for the admin agent slice. Envelope-free; the data layer maps
// the (loosely-typed `unknown`) API responses onto these and converts domain
// input payloads to the wire DTOs.

import type { IAgentLimits } from './agentLimit.types';

export type AgentStatusTypes =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped'
  // Pod is healthy but the runtime never registered on the bridle hub —
  // the agent cannot serve chat until settings are fixed and it restarts.
  | 'unreachable';

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

/**
 * What the collapsed Logs bar renders, as the api already worked it out
 * (CLEAN-233): the newest line raw, and the two figures beside it. Counted
 * over the window the api read, not the pod's whole history.
 */
export interface IAgentLogSummary {
  logs: string;
  total: number;
  alerts: number;
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
  /** Human-readable cause; non-null while status is 'failed' or
   *  'unreachable', and during 'deploying' when bridle settings are empty. */
  statusReason: string | null;
  workflowId: string | null;
  /** Null ⇒ the agent has never been deployed. */
  firstDeployedAt: string | null;
  /** When the current/last deploy was started — every start/restart stamps
   *  it. Pair with launchContext to render "restarted N ago". */
  lastDeployStartedAt: string | null;
  launchContext: LaunchContextTypes | null;
  /** When the running pod last pulled its file working copy from S3 (at
   *  boot). Null ⇒ not restarted since the field shipped. */
  lastPullAt: string | null;
  /** When the last successful Sync push completed. */
  lastSyncAt: string | null;
  config: Record<string, unknown>;
  resources: IAgentResources;
  isPublic: boolean;
  allowedOrigins: string[];
  knowledgeIds: string[];
  isAdmin: boolean;
  debugEnabled: boolean;
  /** Installation-wide pin (CLEAN-216): the rail lists pinned agents right
   *  after Rancher. Toggled from the header; the app console shows the same
   *  flag. Changes nothing about the pod, the status or access. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateAgentData {
  name: string;
  templateId: string;
  llmCredentialId?: string | null;
  config?: Record<string, unknown>;
  resources?: IAgentResources;
  // No `isPublic` / `allowedOrigins`: an agent is created private, and both —
  // with the request limits a public agent must have — are set afterwards in
  // the Access and Request limit blocks of its Overview (CLEAN-224, CLEAN-228).
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
  /** Request limits, applied in the same save as the two fields above
   *  (CLEAN-224). `null` switches them off; absent leaves them as they are.
   *  The server refuses a save that would leave a public agent without one. */
  limits?: IAgentLimits | null;
  knowledgeIds?: string[];
  debugEnabled?: boolean;
  pinned?: boolean;
}
