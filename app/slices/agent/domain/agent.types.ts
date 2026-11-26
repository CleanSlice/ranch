// Domain types for the agent slice. Envelope-free; the data layer maps the
// SDK's (loosely-typed `unknown`) responses onto these and converts domain
// input payloads to the wire DTOs.

export interface IAgentData {
  id: string;
  name: string;
  status: string;
  templateId: string;
  workflowId: string | null;
  config: Record<string, unknown>;
  resources: { cpu: string; memory: string };
  isPublic: boolean;
  /**
   * Page origins the hub lets an anonymous visitor chat from. The landing
   * page previews only agents that list its own origin (CLEAN-179); the
   * admin console is where the list is edited.
   */
  allowedOrigins: string[];
  /** The Ranch admin agent — the one that manages the install. Pinned first
   *  in the rail, as in the admin console (CLEAN-136). */
  isAdmin: boolean;
  /** The signed-in account's own pin (CLEAN-216, personal since CLEAN-231):
   *  every list in both consoles puts the agents this account pinned ahead
   *  of the rest, after the admin agent. Anyone who reaches the agent sets
   *  it; it changes nothing about the pod, the status, access, or anybody
   *  else's list. */
  pinned: boolean;
  /** How its tool servers stand (CLEAN-245): still being reached after a
   *  start, running without some of them, or null — all answer, or the agent
   *  is not running. The word only; which server is a manager's question
   *  (`IAgentToolState`). */
  toolState: ToolSummaryTypes;
  /** What the current or last launch was (CLEAN-247): the first ever, a
   *  start of an agent that held no instance, or a restart of a live one.
   *  The server's word, so everyone looking sees the same list of steps. */
  launchContext: LaunchContextTypes | null;
  /** The server's reason for a failure, shown as received. */
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LaunchContextTypes = 'initial' | 'start' | 'restart';
export type ToolSummaryTypes = 'connecting' | 'limited' | null;
export type ToolServerStateTypes = 'connected' | 'retrying' | 'refused';

/** One tool server of an agent, as its runtime last reported it. */
export interface IAgentToolServer {
  id: string | null;
  /** The operator's own name for it: shown as received. */
  name: string;
  state: ToolServerStateTypes;
  since: string;
  attempts: number;
  /** Redacted by the runtime; shown as received. */
  lastError: string | null;
}

/** What a manager is told about an agent's tool servers (CLEAN-245). */
export interface IAgentToolState {
  phase: 'connecting' | 'limited' | 'ready';
  since: string;
  servers: IAgentToolServer[];
}

/** Payload to create an agent. Mirrors the fields the app sends; the mapper
 *  converts it to the generated `CreateAgentDto`. */
export interface IAgentCreateInput {
  name: string;
  templateId: string;
  llmCredentialId?: string;
  config?: Record<string, unknown>;
  resources?: { cpu: string; memory: string };
  isPublic?: boolean;
  allowedOrigins?: string[];
  knowledgeIds?: string[];
  isAdmin?: boolean;
}

/** Payload to update an agent — every create field optional, plus debug.
 *  Not the pin: it is the account's, not the agent's, and has routes of its
 *  own (`setPinned`); the API refuses an update that carries it. */
export interface IAgentUpdateInput extends Partial<IAgentCreateInput> {
  debugEnabled?: boolean;
}

/** Cluster headroom for new agents — the headline numbers only; per-node
 *  detail stays behind the API. `null` end-to-end when K8s is unreachable. */
export interface IClusterCapacityData {
  freeAgentSlots: number;
  usedAgentSlots: number;
  totalAgentSlots: number;
}

/** One internal agent-to-agent connection: `agentId` can ask `peerAgentId`.
 *  Read for the orbit map, which draws it; operators only (CLEAN-215). */
export interface IAgentLinkData {
  agentId: string;
  peerAgentId: string;
}
