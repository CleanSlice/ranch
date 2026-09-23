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
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { ApiKeyScopeTypes, IApiKeyGateway, ApiKeyService } from './domain';
import type { IApiKeyData } from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** What the person reads right after the key: it exists nowhere else. */
export const KEY_SHOWN_ONCE =
  'This key is shown once. Hand it to the person verbatim and do not ' +
  'repeat it in later messages.';

/** What `CreateApiKeyDto` allows for a name. */
const MIN_NAME_LENGTH = 2;

const scopeSchema = z
  .nativeEnum(ApiKeyScopeTypes)
  .describe(
    'embed:mint — mint browser embed tokens; embed:mint-admin — the same ' +
      'but keeping Owner/Admin roles (effectively admin); admin — the full API.',
  );

/**
 * A row as a tool result: the prefix and the metadata the console table
 * shows, listed field by field. A whitelist rather than a strip of known
 * secret names, because the one thing this listing must never carry is the
 * key hash, and a gateway that someday returns it (or the key itself) must
 * not get a say (FR-004).
 */
function toToolApiKey(row: IApiKeyData) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function notFound(id: string): ToolResult {
  return ok({
    error: `API key ${id} not found — call list_api_keys to find the id`,
  });
}

/**
 * The API keys page from the chat (CLEAN-109). Every call goes through
 * `ApiKeyService` and `IApiKeyGateway`, the pair `ApiKeyController` injects,
 * so the key format, the hashing and the prefix are decided in one place.
 *
 * This is the one tool file allowed to hand a secret back: `create_api_key`
 * returns the plaintext key once, exactly as the console does, because only
 * its hash is persisted and the key exists nowhere else afterwards (research
 * R6). Everything else here returns prefix and metadata only.
 *
 * Operator agents only: a key with the `admin` scope is the whole API, and a
 * plain agent must not be able to mint one on a prompt's say-so.
 */
@Injectable()
export class ApiKeyTool implements IConditionallyListedTool {
  private readonly logger = new Logger(ApiKeyTool.name);

  constructor(
    private readonly gateway: IApiKeyGateway,
    private readonly service: ApiKeyService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'list_api_keys',
    topic: ToolTopics.UsersKeys,
    title: 'List API keys',
    template: 'List the API keys',
    description:
      'Every API key of this Ranch with its id, name, the last 4 characters ' +
      '(prefix), scopes, expiry, last use and who created it — never the key ' +
      'itself; the server only keeps a hash, so no tool can show it again. ' +
      'Read this to turn a name the person said into the id revoke_api_key ' +
      'needs.',
  })
  async listApiKeys(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const rows = await this.service.list();
    return ok({ apiKeys: rows.map(toToolApiKey) });
  }

  @Tool({
    name: 'create_api_key',
    topic: ToolTopics.UsersKeys,
    title: 'Create an API key',
    template: 'Create an API key named «name» with the scopes «scopes»',
    description:
      'Mint a new API key. The result carries the plaintext key ONCE: only ' +
      'its hash is stored, so it cannot be shown again by any tool or the ' +
      'console. ' +
      KEY_SHOWN_ONCE +
      ' Scopes: embed:mint mints browser embed tokens; embed:mint-admin ' +
      'keeps Owner/Admin roles in them (treat it like admin); admin is the ' +
      'full API. Omit expiresAt for a key that never expires. The key is ' +
      'recorded as created by the calling agent (agent:<id>), which is what ' +
      'the API keys page shows in its "created by" column.',
    parameters: z.object({
      name: z
        .string()
        .min(MIN_NAME_LENGTH)
        .describe('A label for the key, e.g. "Marketing site embed"'),
      scopes: z.array(scopeSchema).min(1).describe('At least one scope'),
      expiresAt: z
        .string()
        .optional()
        .describe(
          'ISO date-time when the key stops working, e.g. 2027-01-01T00:00:00Z. Omit for no expiry.',
        ),
    }),
  })
  async createApiKey(
    {
      name,
      scopes,
      expiresAt,
    }: { name: string; scopes: ApiKeyScopeTypes[]; expiresAt?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    // The controller takes `req.user.sub` as-is; for an admin agent that is
    // `agent:<id>`. The column is a plain string, so it is stored the same way.
    const createdBy = httpRequest.user?.sub;
    if (!createdBy)
      return err('Cannot tell who is calling; not creating a key.');
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && Number.isNaN(expiry.getTime())) {
      return err(
        `expiresAt "${expiresAt}" is not an ISO date-time. Use e.g. 2027-01-01T00:00:00Z, or omit it.`,
      );
    }
    const created = await this.service.create({
      name,
      // The DTO rejects duplicates with a 400; a tool call with the same
      // scope twice means the same thing, so fold it instead of refusing.
      scopes: Array.from(new Set(scopes)),
      expiresAt: expiry,
      createdBy,
    });
    // Log the id and name, never the key: the API log is not a secret store.
    this.logger.log(
      `API key created through MCP: id=${created.apiKey.id} name=${name} by=${createdBy}`,
    );
    return ok({
      apiKey: toToolApiKey(created.apiKey),
      key: created.key,
      note: KEY_SHOWN_ONCE,
    });
  }

  @Tool({
    name: 'revoke_api_key',
    topic: ToolTopics.UsersKeys,
    title: 'Revoke an API key',
    template: 'Revoke the API key «name»',
    destructive: true,
    description:
      'Delete an API key. Anything still sending it stops authenticating ' +
      'immediately, and it cannot be restored — the person would create a ' +
      'new key and roll it out again. Takes the id: list_api_keys turns a ' +
      'name into one. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('Key id, e.g. apikey-… (list_api_keys has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async revokeApiKey(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { id } = args;
    const found = await this.gateway.findById(id);
    if (!found) return notFound(id);
    const refusal = confirmed(
      args,
      `revoke the API key «${found.name}» (…${found.prefix}) — whatever uses it stops working at once`,
    );
    if (refusal) return refusal;
    await this.service.revoke(id);
    this.logger.log(`API key revoked through MCP: id=${id} name=${found.name}`);
    return ok({
      ok: true,
      id,
      name: found.name,
      note:
        `API key «${found.name}» is revoked. Anything that was using it needs ` +
        'a new key — create_api_key mints one.',
    });
  }
}
