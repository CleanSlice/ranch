import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { CanActivate, Type } from '@nestjs/common';

export enum McpTransportType {
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable-http',
  STDIO = 'stdio',
}

export interface McpOptions {
  // When and if, additional properties are introduced in ServerOptions or ServerInfo,
  // consider deprecating these fields in favor of using ServerOptions and ServerInfo directly.
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
  instructions?: string;

  transport?: McpTransportType | McpTransportType[];
  sseEndpoint?: string;
  messagesEndpoint?: string;
  mcpEndpoint?: string;
  globalApiPrefix?: string;
  guards?: Type<CanActivate>[];
  decorators?: ClassDecorator[];
  /**
   * Decorators for the diagnostic routes alone (the SSE controller's
   * `teams/:teamId/sessions/debug`, which lists live session ids). They sit
   * on the handler, so they win over `decorators` on the class: the endpoints
   * a client speaks MCP on can be open to every bearer while the diagnostics
   * stay with an operator.
   */
  diagnosticDecorators?: MethodDecorator[];
  sse?: {
    pingEnabled?: boolean;
    pingIntervalMs?: number;
  };
  streamableHttp?: {
    enableJsonResponse?: boolean;
    sessionIdGenerator?: () => string;
    /**
     * @experimental: The current implementation does not fully comply with the MCP Specification.
     */
    statelessMode?: boolean;
  };
}
