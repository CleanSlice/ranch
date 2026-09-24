import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IMcpServerGateway } from './domain';
import { McpProbeService } from './domain/mcpProbe.service';
import type { IMcpProbeResult } from './domain/mcpProbe.types';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * `probe_mcp_server` (CLEAN-78): the step before `register_mcp_server` that
 * the registry tools left to the person. Given a URL it reports transport,
 * whether a credential is needed and of which kind, and the tools on offer;
 * given a registered server's id it checks the row as it is, credential
 * included, so "is Jira still answering" is one call.
 *
 * Operator-only like the rest of the registry. A pasted URL goes through the
 * same public-address guard the A2A peer flow applies (a probe reports
 * tools/list output into the chat, which is exactly what an SSRF wants); a
 * registered row skips it, because the built-in servers live on cluster
 * hosts by design and a registered address is the operator's own choice.
 *
 * Results never carry a credential: the service is given the row's
 * `authValue` and answers only with what it proved about it.
 */
@Injectable()
export class McpProbeTool implements IConditionallyListedTool {
  private readonly logger = new Logger(McpProbeTool.name);

  constructor(
    private readonly probe: McpProbeService,
    private readonly servers: IMcpServerGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'probe_mcp_server',
    topic: ToolTopics.McpServers,
    title: 'Check what an MCP server offers',
    template: 'Check what the MCP server at «url» offers',
    description:
      'Look at an MCP endpoint before registering it, or re-check a ' +
      'registered one. Pass `url` for a new server or `id` for a registered ' +
      'one (list_mcp_servers has the ids). Reports the transport that ' +
      'answered (streamableHttp or sse), whether a credential is required ' +
      'and which authType to register with (none, bearer, or oauth when the ' +
      'origin publishes OAuth metadata), the OAuth capabilities (dynamic ' +
      'registration, PKCE), the server name, and its tool list when it could ' +
      'be asked. An OAuth server cannot list tools until an agent connects ' +
      'through start_mcp_oauth; that is expected, not a failure. Feed ' +
      '`transport` and `authType` into register_mcp_server. Private and ' +
      'local addresses are refused for a pasted url.',
    parameters: z.object({
      url: z.string().optional().describe('The MCP endpoint URL to look at'),
      id: z
        .string()
        .optional()
        .describe(
          'A registered MCP server id — probes its stored url and credential',
        ),
    }),
  })
  async probeMcpServer(
    args: { url?: string; id?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    if (!args.url && !args.id) {
      return err('Pass either url (a new server) or id (a registered one).');
    }

    let result: IMcpProbeResult;
    let registered: { id: string; name: string } | null = null;
    try {
      if (args.id) {
        const server = await this.servers.findById(args.id);
        if (!server) {
          return ok({
            error: `MCP server ${args.id} not found — call list_mcp_servers to find the id`,
          });
        }
        registered = { id: server.id, name: server.name };
        result = await this.probe.probe({
          url: server.url,
          authType: server.authType,
          authValue: server.authValue,
          allowPrivate: true,
        });
      } else {
        result = await this.probe.probe({ url: args.url as string });
      }
    } catch (error) {
      // The guard's and the URL parser's refusals name what is wrong with
      // the address; anything else is not a probe finding and escapes.
      if (!(error instanceof HttpException)) throw error;
      return err(`${error.message} Nothing was probed.`);
    }

    this.logger.log(
      `MCP probe through MCP: ${registered ? `id=${registered.id}` : 'url'} reachable=${result.reachable} transport=${result.transport ?? '-'} authType=${result.authType ?? '-'} tools=${result.tools?.length ?? '-'}`,
    );
    return ok({
      ...(registered ? { registered } : {}),
      ...result,
      next: nextMove(result, registered),
    });
  }
}

/** What the model should do with the finding, in one line. */
function nextMove(
  result: IMcpProbeResult,
  registered: { id: string; name: string } | null,
): string {
  if (registered) {
    if (result.reachable) {
      return `«${registered.name}» answers over ${result.transport} with ${result.tools?.length ?? 0} tools.`;
    }
    if (result.authRequired && result.authType === 'oauth') {
      return `«${registered.name}» is an OAuth server; each agent connects through start_mcp_oauth.`;
    }
    return `«${registered.name}» did not answer as registered — check the url or credential with update_mcp_server.`;
  }
  if (result.reachable) {
    return `Register it with register_mcp_server using transport=${result.transport} and authType=none, then set_template_mcps and restart_agent.`;
  }
  if (result.authRequired && result.authType === 'oauth') {
    const dcr = result.oauth?.dynamicRegistration
      ? ''
      : ' Note: the server does not offer dynamic client registration, so start_mcp_oauth will refuse until a client id is configured.';
    return `Register it with register_mcp_server using transport=${result.transport} and authType=oauth (no authValue), attach it with set_template_mcps, then connect an agent with start_mcp_oauth.${dcr}`;
  }
  if (result.authRequired) {
    return `Register it with transport=${result.transport} and authType=bearer or header, supplying the credential the person has; then probe it by id to confirm.`;
  }
  return 'The endpoint did not answer as an MCP server; check the address with the person before registering anything.';
}
