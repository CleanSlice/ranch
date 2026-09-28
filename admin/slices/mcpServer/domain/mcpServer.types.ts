// Domain types for MCP servers.

export type McpServerTransportTypes = 'streamableHttp' | 'sse';
export type McpServerAuthTypes = 'none' | 'bearer' | 'header' | 'oauth';

/**
 * Built-in servers the API hands to EVERY agent whatever its template says
 * (api: mcpServer/domain/agentMcpResolver.service.ts). A template cannot
 * detach them — an operator turns them off by disabling the row on the MCP
 * servers page — so the template page must not draw them as choices.
 * Mirrors the seeder ids; the seeder is the source of truth.
 */
export const ALWAYS_ON_MCP_IDS: readonly string[] = ['mcp-cleanslice', 'mcp-documents'];

/** Attached by the resolver only when the agent or template has knowledge bases. */
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';

export interface IMcpServerData {
  id: string;
  name: string;
  description: string | null;
  url: string;
  transport: McpServerTransportTypes;
  authType: McpServerAuthTypes;
  authValue: string | null;
  enabled: boolean;
  builtIn: boolean;
  templateIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ICreateMcpServerData {
  name: string;
  description?: string | null;
  url: string;
  transport?: McpServerTransportTypes;
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  enabled?: boolean;
}

export interface IUpdateMcpServerData {
  name?: string;
  description?: string | null;
  url?: string;
  transport?: McpServerTransportTypes;
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  enabled?: boolean;
}
