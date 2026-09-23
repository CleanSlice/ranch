/**
 * The chat's Tools panel (CLEAN-109): the tools this agent's runtime would
 * receive, grouped by topic, plus its external MCP servers as opaque groups.
 * Mirrors the API's AgentToolCatalogDto; see
 * specs/016-agent-tool-parity/data-model.md §3.
 */

export type AgentToolGroupKinds = 'builtin' | 'external';

export interface IAgentToolEntry {
  name: string;
  title: string;
  description: string;
  /** Starter prompt with «…» placeholders — a starter, not a form. */
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
  description?: string;
  afterRestart: boolean;
  tools: IAgentToolEntry[];
}

/**
 * none — no pod runs; pending — the running pod has not listed its tools yet;
 * fresh — the per-tool `inPod` flags come from this pod.
 */
export type ToolListingStates = 'none' | 'pending' | 'fresh';

export interface IAgentToolCatalog {
  agentId: string;
  podStartedAt: string | null;
  listedAt: string | null;
  listingState: ToolListingStates;
  groups: IAgentToolGroup[];
}

export abstract class IToolCatalogGateway {
  abstract forAgent(agentId: string): Promise<IAgentToolCatalog>;
}
