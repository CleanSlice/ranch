import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerAgentId,
  callerIsOperator,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { McpOauthService } from './domain/mcpOauth.service';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * The in-chat OAuth "Connect" for an MCP server, as a tool (CLEAN-109). It
 * mirrors `POST mcp-servers/:id/oauth/start` and lives in this folder, not in
 * `mcpServer.tool.ts`, because `McpOauthModule` imports `McpServerModule` for
 * the gateway: registering it there would need the import the other way too,
 * and a cycle for one tool is a poor trade.
 *
 * `McpOauthService` does the work — server lookup, discovery, one-time client
 * registration, PKCE state — exactly as for the console. The tool adds only
 * the two things a model needs: which agent the connection belongs to (the
 * caller, unless told otherwise) and what to do with the URL that comes back.
 */
@Injectable()
export class McpOauthTool implements IConditionallyListedTool {
  private readonly logger = new Logger(McpOauthTool.name);

  constructor(private readonly oauth: McpOauthService) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'start_mcp_oauth',
    topic: ToolTopics.McpServers,
    title: 'Start OAuth for a server',
    template: 'Connect the MCP server «name» with OAuth',
    description:
      'Begin the OAuth connect for an MCP server registered with authType ' +
      'oauth. Returns an authorization URL: give it to the person to open in ' +
      'their browser; they log in at the provider, and the callback stores ' +
      'the token for the agent named by `agentId` (the calling agent when ' +
      'omitted) and wakes it. Without `subject` this is the agent-wide ' +
      'connection everyone who talks to that agent shares; a person who ' +
      'wants their own account connects from that agent\'s chat instead, ' +
      'where its «server»__connect tool keys the token to them. The link is ' +
      'single-use and expires in ten minutes. Find the server id with ' +
      'list_mcp_servers.',
    parameters: z.object({
      serverId: z
        .string()
        .describe('MCP server id (list_mcp_servers has them)'),
      agentId: z
        .string()
        .optional()
        .describe(
          'Agent that will own the connection. Defaults to the calling agent.',
        ),
      subject: z
        .string()
        .max(200)
        .optional()
        .describe(
          'Whose token this will be (a user id). Omit for the agent-wide connection.',
        ),
    }),
  })
  async startMcpOauth(
    {
      serverId,
      agentId,
      subject,
    }: { serverId: string; agentId?: string; subject?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const owner = agentId ?? callerAgentId(httpRequest);
    if (!owner) {
      return err(
        'Pass agentId: the token is stored for one agent, and this caller is ' +
          'not an agent. list_agents has the ids.',
      );
    }
    try {
      const { authorizeUrl } = await this.oauth.start({
        serverId,
        agentId: owner,
        ...(subject ? { subject } : {}),
      });
      this.logger.log(
        `OAuth connect started through MCP: server=${serverId} agent=${owner} subject=${subject ?? 'agent-wide'}`,
      );
      return ok({
        authorizeUrl,
        agentId: owner,
        subject: subject ?? owner,
        instruction:
          'Send this URL to the person and ask them to open it in their ' +
          'browser and log in at the provider. Once they see "Connected", ' +
          `the token is stored for ${subject ? `subject ${subject} on ` : ''}${owner} — nothing more to call here.`,
      });
    } catch (error) {
      // The service's own refusals — no such server, not oauth, no public
      // URL, no dynamic registration — each name a cause the model can act
      // on; anything else is not ours to interpret and escapes as an error.
      if (!(error instanceof HttpException)) throw error;
      return err(`${error.message} ${nextMove(error.message)}`);
    }
  }
}

/** Turn the service's refusal into the tool call that fixes it. */
function nextMove(message: string): string {
  if (message.includes('not found')) {
    return 'Call list_mcp_servers to find the id.';
  }
  if (message.includes('not OAuth-based')) {
    return 'Set its authType to oauth with update_mcp_server first.';
  }
  return 'Tell the person; this is not something a tool call fixes.';
}
