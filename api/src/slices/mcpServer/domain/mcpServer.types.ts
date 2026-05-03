export type McpServerTransportTypes = 'streamableHttp' | 'sse';
export type McpServerAuthTypes = 'none' | 'bearer' | 'header';

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
  enabled?: boolean;
}
