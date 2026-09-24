import type { McpServerAuthTypes, McpServerTransportTypes } from './mcpServer.types';

/**
 * What a probe learned about an MCP endpoint (CLEAN-78). Everything here is
 * safe to hand to a model: it never carries a credential, only whether one
 * is needed and of which kind.
 */
export interface IMcpProbeResult {
  url: string;
  /** An MCP handshake succeeded on `transport`. */
  reachable: boolean;
  /** The transport that answered, or null when none did. */
  transport: McpServerTransportTypes | null;
  /**
   * What `register_mcp_server` should be told. `oauth` when the origin
   * publishes OAuth authorization-server metadata and the endpoint demanded
   * a token; `bearer` when it demanded a token but publishes no metadata
   * (the person has to supply one); `none` when the handshake went through
   * without credentials. Null when nothing could be learned.
   */
  authType: McpServerAuthTypes | null;
  /** The endpoint answered 401/403 to an unauthenticated handshake. */
  authRequired: boolean;
  /** Present when `/.well-known/oauth-authorization-server` answered. */
  oauth: IMcpProbeOauth | null;
  /** From `initialize`, when the handshake went through. */
  server: { name: string; version: string } | null;
  /** From `tools/list`; null when the server could not be asked. */
  tools: IMcpProbeTool[] | null;
  /** Why it is not reachable, in one line; absent when it is. */
  error?: string;
}

export interface IMcpProbeOauth {
  issuer: string;
  /** RFC 7591 dynamic client registration — what `start_mcp_oauth` needs. */
  dynamicRegistration: boolean;
  /** PKCE S256 advertised, or metadata silent on it (then assumed). */
  pkce: boolean;
  scopes: string[];
}

export interface IMcpProbeTool {
  name: string;
  description: string;
}

/** Headers a probe sends: a stored bearer/header credential, never logged. */
export type McpProbeHeaders = Record<string, string>;

/** One MCP handshake attempt over one transport. */
export interface IMcpProbeHandshake {
  server: { name: string; version: string } | null;
  tools: IMcpProbeTool[];
}

/**
 * Thrown by the connector when the endpoint answered an HTTP status instead
 * of talking MCP. `status` is what the probe reasons about: 401/403 means a
 * credential is wanted, 404/405 on streamable HTTP means try SSE.
 */
export class McpProbeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'McpProbeHttpError';
  }
}

/**
 * The network half of a probe, behind an interface so the service's decision
 * logic is unit-tested without the SDK or a socket. The data layer implements
 * it with the MCP SDK's client transports.
 */
export abstract class IMcpProbeConnector {
  abstract handshake(
    url: string,
    transport: McpServerTransportTypes,
    headers: McpProbeHeaders,
  ): Promise<IMcpProbeHandshake>;
}
