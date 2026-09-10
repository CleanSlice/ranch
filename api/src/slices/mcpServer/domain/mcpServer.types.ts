export type McpServerTransportTypes = 'streamableHttp' | 'sse';
// 'oauth' — the runtime authenticates with an OAuth 2.1 bearer it refreshes
// itself from a per-agent refresh token, obtained once via the in-chat Connect
// flow (the agent sends the user a link, the user logs in, the callback stores
// the token). authValue is unused for oauth; the shared registered client_id
// lives in McpServer.oauthClientId and the per-agent tokens in the agent
// secret store.
export type McpServerAuthTypes = 'none' | 'bearer' | 'header' | 'oauth';

export interface IMcpServerData {
  id: string;
  name: string;
  description: string | null;
  url: string;
  transport: McpServerTransportTypes;
  authType: McpServerAuthTypes;
  authValue: string | null;
  oauthClientId: string | null;
  enabled: boolean;
  builtIn: boolean;
  templateIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateMcpServerData {
  id?: string;
  name: string;
  description?: string | null;
  url: string;
  transport?: McpServerTransportTypes;
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  enabled?: boolean;
  builtIn?: boolean;
}

export interface IUpdateMcpServerData {
  name?: string;
  description?: string | null;
  url?: string;
  transport?: McpServerTransportTypes;
  authType?: McpServerAuthTypes;
  authValue?: string | null;
  oauthClientId?: string | null;
  enabled?: boolean;
}
