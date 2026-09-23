/**
 * The Tools panel's data (CLEAN-109): what this agent's runtime would receive
 * from the built-in Ranch MCP server, grouped by topic, plus its external MCP
 * servers as opaque groups. See specs/016-agent-tool-parity/data-model.md §3.
 */

export type AgentToolGroupKinds = 'builtin' | 'external';

export interface IAgentToolEntry {
  name: string;
  title: string;
  /** The per-caller description, exactly what the runtime would be given. */
  description: string;
  /** Starter prompt with «…» placeholders. */
  template: string;
  destructive: boolean;
  /** null — no pod; false — the running pod did not list it; true — it did. */
  inPod: boolean | null;
}

export interface IAgentToolGroup {
  /** Topic key, or `mcp:<serverId>` for an external server. */
  key: string;
  title: string;
  kind: AgentToolGroupKinds;
  /** External servers only — the row's description. Never url or auth. */
  description?: string;
  /**
   * builtin — at least one tool has inPod === false; external — the server
   * row changed after the pod started (the mcp-status rule).
   */
  afterRestart: boolean;
  /** Empty for external groups; their tools are served by the server itself. */
  tools: IAgentToolEntry[];
}

export interface IAgentToolCatalog {
  agentId: string;
  /** ISO; null when no pod runs. */
  podStartedAt: string | null;
  /** ISO of the last tools/list the pod made; null if it never did. */
  listedAt: string | null;
  groups: IAgentToolGroup[];
}

/** The snapshot row: what the pod was last told it has. */
export interface IAgentToolListingData {
  agentId: string;
  toolNames: string[];
  listedAt: Date;
}

export abstract class IToolListingGateway {
  abstract record(agentId: string, toolNames: string[]): Promise<void>;
  abstract findByAgent(agentId: string): Promise<IAgentToolListingData | null>;
}
