import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  IMcpProbeConnector,
  McpProbeHttpError,
  type IMcpProbeHandshake,
  type McpProbeHeaders,
} from '../domain/mcpProbe.types';
import type { McpServerTransportTypes } from '../domain/mcpServer.types';

/** One handshake plus tools/list may not take longer than this. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

const CLIENT_INFO = { name: 'ranch-probe', version: '1.0.0' };

/**
 * The MCP SDK's own client transports, used the way the runtime uses them
 * (`setup/mcp/data/mcp.gateway.ts`), so "the probe says reachable" and "the
 * agent can connect" mean the same thing. No auth provider: a probe never
 * runs an OAuth flow — a 401 is the finding, not an obstacle.
 */
@Injectable()
export class McpProbeConnector extends IMcpProbeConnector {
  async handshake(
    url: string,
    transport: McpServerTransportTypes,
    headers: McpProbeHeaders,
  ): Promise<IMcpProbeHandshake> {
    const target = new URL(url);
    const wire: Transport =
      transport === 'sse'
        ? new SSEClientTransport(target, {
            requestInit: { headers },
            // The SSE GET is made by an EventSource that ignores
            // `requestInit`; route it through fetch so a header credential
            // reaches the stream request too.
            eventSourceInit: {
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  headers: { ...headersOf(init?.headers), ...headers },
                }),
            },
          })
        : new StreamableHTTPClientTransport(target, {
            requestInit: { headers },
          });

    const client = new Client(CLIENT_INFO);
    try {
      await withTimeout(client.connect(wire), HANDSHAKE_TIMEOUT_MS);
      const listed = await withTimeout(client.listTools(), HANDSHAKE_TIMEOUT_MS);
      const info = client.getServerVersion();
      return {
        server: info ? { name: info.name, version: info.version } : null,
        tools: listed.tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
        })),
      };
    } catch (error) {
      throw translate(error);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

/**
 * The SDK reports an HTTP refusal as `StreamableHTTPError` / `SseError` with
 * the status in `code`; a 401 without an auth provider surfaces as
 * `UnauthorizedError` with no code at all. All three become one error the
 * service can reason about by status.
 */
function translate(error: unknown): Error {
  if (error instanceof McpProbeHttpError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'UnauthorizedError') {
    return new McpProbeHttpError(401, 'Unauthorized');
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number' && code >= 100 && code < 600) {
    return new McpProbeHttpError(code, message);
  }
  // The SDK sometimes folds the status into the message only
  // ("Error POSTing to endpoint (HTTP 405): ..."); read it back out.
  const inline = /HTTP (\d{3})/.exec(message);
  if (inline) return new McpProbeHttpError(Number(inline[1]), message);
  return error instanceof Error ? error : new Error(message);
}

function headersOf(init: HeadersInit | undefined): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) return Object.fromEntries(init.entries());
  if (Array.isArray(init)) return Object.fromEntries(init);
  return { ...init };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MCP handshake timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
