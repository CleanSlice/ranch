import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  err,
  ok,
  requireOperator,
  stripSecrets,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IMcpServerGateway } from './domain';
import type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
} from './domain';
import type { UpdateMcpServerDto } from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const TRANSPORTS = ['streamableHttp', 'sse'] as const;
const AUTH_TYPES = ['none', 'bearer', 'header', 'oauth'] as const;

/**
 * What a row must never carry into a tool result: the bearer/header value and
 * the OAuth client id the api registered for itself. `stripSecrets` knows
 * `authValue`; `oauthClientId` is this slice's own, so it is named here.
 */
const HIDDEN_FIELDS = [
  'authValue',
  'oauthClientId',
  'apiKey',
  'password',
  'passwordHash',
  'secret',
  'token',
] as const;

const NOT_FOUND = (id: string) =>
  `MCP server ${id} not found — call list_mcp_servers to find the id`;

/** The console's "attach it to a template" reminder, in one place. */
const ATTACH_LINE =
  'An MCP server only reaches agents through a template: attach it with ' +
  'set_template_mcps, then restart_agent for every agent of that template.';

/**
 * The MCP server registry from the chat (CLEAN-109): what the console does
 * under "MCP servers", mirrored one tool per endpoint of
 * `McpServerController`. Every call goes through `IMcpServerGateway`, the
 * same gateway the controller uses, and the two rules the controller holds
 * are held here too: a built-in row (Ranch's own MCP) accepts only `enabled`
 * and `description`, and is never deleted — only disabled.
 *
 * Credentials go one way. `register_mcp_server` and `update_mcp_server` take
 * an `authValue`, store it, and acknowledge without echoing it; no result of
 * these tools ever carries `authValue` or `oauthClientId` (FR-004).
 *
 * Operator-only: the Ranch admin agent holds the Owner role, a plain agent
 * does not — for it these tools are not listed, and a call by name is
 * refused.
 */
@Injectable()
export class McpServerTool implements IConditionallyListedTool {
  private readonly logger = new Logger(McpServerTool.name);

  constructor(private readonly servers: IMcpServerGateway) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  private present(server: IMcpServerData) {
    return stripSecrets(server, HIDDEN_FIELDS);
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_mcp_servers',
    topic: ToolTopics.McpServers,
    title: 'List MCP servers',
    template: 'List the MCP servers registered in this Ranch',
    description:
      'Every MCP server registered in this Ranch: id, name, url, transport, ' +
      'auth type, whether it is enabled, whether it is built in (Ranch’s ' +
      'own MCP), and the ids of the templates it is attached to. Credentials ' +
      'are never returned. Use it to turn a name the person said into the id ' +
      'the other mcp server tools need.',
    parameters: z.object({}),
  })
  async listMcpServers(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const rows = await this.servers.findAll();
    return ok(rows.map((row) => this.present(row)));
  }

  @Tool({
    name: 'get_mcp_server',
    topic: ToolTopics.McpServers,
    title: 'Show an MCP server',
    template: 'Show the MCP server «name»',
    description:
      'One MCP server by id, with its url, transport, auth type, enabled ' +
      'flag, built-in flag and the templates it is attached to. The stored ' +
      'credential is never returned — only its type. Find the id with ' +
      'list_mcp_servers.',
    parameters: z.object({
      id: z.string().describe('MCP server id (list_mcp_servers has them)'),
    }),
  })
  async getMcpServer(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const server = await this.servers.findById(id);
    if (!server) return ok({ error: NOT_FOUND(id) });
    return ok(this.present(server));
  }

  // ─── Changing ────────────────────────────────────────────────────────

  @Tool({
    name: 'register_mcp_server',
    topic: ToolTopics.McpServers,
    title: 'Register an MCP server',
    template:
      'Register the MCP server at «url» named «name» with «bearer|none» auth',
    description:
      'Register a new MCP server so templates can attach it. `authType` says ' +
      'how the runtime authenticates: none, bearer (authValue is the token), ' +
      'header (authValue is the full header value), or oauth (no authValue — ' +
      'each agent connects through start_mcp_oauth). The credential is stored ' +
      'and never read back. Registering alone changes nothing for agents: ' +
      'attach the server to a template with set_template_mcps and restart ' +
      'its agents.',
    parameters: z.object({
      name: z.string().max(80).describe('Display name, up to 80 characters'),
      url: z.string().describe('The MCP endpoint URL'),
      description: z.string().optional(),
      transport: z
        .enum(TRANSPORTS)
        .optional()
        .describe('streamableHttp (default) or sse'),
      authType: z
        .enum(AUTH_TYPES)
        .optional()
        .describe('none (default), bearer, header or oauth'),
      authValue: z
        .string()
        .optional()
        .describe(
          'The bearer token or header value. Stored write-only, never returned.',
        ),
      enabled: z.boolean().optional().describe('Default true'),
    }),
  })
  async registerMcpServer(
    args: {
      name: string;
      url: string;
      description?: string;
      transport?: (typeof TRANSPORTS)[number];
      authType?: (typeof AUTH_TYPES)[number];
      authValue?: string;
      enabled?: boolean;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const data: ICreateMcpServerData = {
      name: args.name,
      url: args.url,
      description: args.description,
      transport: args.transport,
      authType: args.authType,
      authValue: args.authValue,
      enabled: args.enabled,
    };
    const server = await this.servers.create(data);
    this.logger.log(
      `MCP server registered through MCP: id=${server.id} authType=${server.authType}`,
    );
    return ok({
      server: this.present(server),
      credential: args.authValue
        ? 'Credential stored; it is never returned by these tools.'
        : 'No credential stored.',
      next:
        server.authType === 'oauth'
          ? `${ATTACH_LINE} Each agent then connects with start_mcp_oauth.`
          : ATTACH_LINE,
    });
  }

  @Tool({
    name: 'update_mcp_server',
    topic: ToolTopics.McpServers,
    title: 'Update or enable/disable a server',
    template: 'Disable the MCP server «name»',
    description:
      'Change an MCP server: name, description, url, transport, auth type, ' +
      'credential or the enabled flag. Pass only the fields to change. A ' +
      'built-in server (Ranch’s own MCP) accepts only `enabled` and ' +
      '`description`; the rest is ignored and the result says so. A new ' +
      'authValue replaces the stored one and is never read back. Agents of ' +
      'the templates it is attached to pick the change up on their next ' +
      'restart.',
    parameters: z.object({
      id: z.string().describe('MCP server id (list_mcp_servers has them)'),
      name: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
      transport: z.enum(TRANSPORTS).optional(),
      authType: z.enum(AUTH_TYPES).optional(),
      authValue: z
        .string()
        .optional()
        .describe('Replaces the stored credential. Never returned.'),
      enabled: z.boolean().optional(),
    }),
  })
  async updateMcpServer(
    args: { id: string } & UpdateMcpServerDto,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { id, ...dto } = args;
    const existing = await this.servers.findById(id);
    if (!existing) return ok({ error: NOT_FOUND(id) });

    // Only the fields the caller actually sent, so an omitted `enabled`
    // never becomes `enabled: undefined` in the gateway's update.
    const requested = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as IUpdateMcpServerData;

    let data: IUpdateMcpServerData = requested;
    let ignored: string[] = [];
    if (existing.builtIn) {
      // Same rule as McpServerController: built-ins (Ranch's own MCP) can be
      // enabled/disabled but not edited — their url and auth model is owned
      // by the api itself.
      const allowed: IUpdateMcpServerData = {};
      if (requested.enabled !== undefined) allowed.enabled = requested.enabled;
      if (requested.description !== undefined) {
        allowed.description = requested.description;
      }
      data = allowed;
      ignored = Object.keys(requested).filter((key) => !(key in allowed));
    }

    const server = await this.servers.update(id, data);
    this.logger.log(
      `MCP server updated through MCP: id=${id} fields=${Object.keys(data).join(',')}`,
    );
    return ok({
      server: this.present(server),
      changed: Object.keys(data),
      ...(ignored.length
        ? {
            ignored,
            note:
              `«${existing.name}» is built in: only enabled and description ` +
              'can change; the other fields were ignored.',
          }
        : {}),
      ...(requested.authValue !== undefined && data.authValue !== undefined
        ? { credential: 'Credential replaced; it is never returned.' }
        : {}),
      next:
        'Agents of the templates this server is attached to use the new ' +
        'settings after restart_agent.',
    });
  }

  @Tool({
    name: 'delete_mcp_server',
    topic: ToolTopics.McpServers,
    title: 'Delete an MCP server',
    template: 'Delete the MCP server «name»',
    destructive: true,
    description:
      'Remove an MCP server from the registry, detaching it from every ' +
      'template. Its stored credential is gone with it. A built-in server ' +
      '(Ranch’s own MCP) cannot be deleted — disable it with ' +
      'update_mcp_server instead. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('MCP server id (list_mcp_servers has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteMcpServer(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const existing = await this.servers.findById(args.id);
    if (!existing) return ok({ error: NOT_FOUND(args.id) });
    if (existing.builtIn) {
      // The controller's exact wording, with the tool that does it here.
      return err(
        'Built-in MCP servers cannot be deleted — disable them via PATCH ' +
          '/mcp-servers/:id { enabled: false } instead. From here: ' +
          `update_mcp_server with id=${args.id}, enabled=false.`,
      );
    }
    const refusal = confirmed(
      args,
      `delete the MCP server «${existing.name}» and detach it from ` +
        `${existing.templateIds.length} template(s)`,
    );
    if (refusal) return refusal;

    await this.servers.delete(args.id);
    this.logger.log(`MCP server deleted through MCP: id=${args.id}`);
    return ok(
      `«${existing.name}» (${args.id}) deleted. Agents of the templates it ` +
        'was attached to still hold it until they restart — restart_agent ' +
        'when the person is ready.',
    );
  }
}
