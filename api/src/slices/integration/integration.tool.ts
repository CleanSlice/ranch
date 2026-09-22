import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  CONFIRM_SENTENCE,
  confirmed,
  err,
  ok,
  stripSecrets,
  type ToolResult,
} from '#/mcp/tooling';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IntegrationService } from './domain/integration.service';
import type { IIntegrationAccountData } from './domain/integration.types';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * Same convention as `browser.tool.ts`: an agent runtime holds a service
 * token (`sub = agent:<id>`), not the user's identity, so it names the user
 * it acts for. The rows and the credential stores are keyed by that user.
 */
const userIdParam = z
  .string()
  .min(1)
  .describe('Owning user — must match the calling principal.');

/** Same charset the console enforces in `ConnectIntegrationDto`. */
const accountKeyParam = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_:.-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, dot, dash',
  })
  .describe(
    'Account handle on the service, e.g. the Instagram username. Becomes the «service:accountKey» profile browser_play uses.',
  );

/**
 * Fields that must never leave through a tool result (FR-004). Integration
 * rows carry lifecycle metadata only — cookies live in the browser-state
 * store, API keys in the secret store — but the list is explicit so a
 * future column with one of these names is dropped without anyone noticing
 * it had to be.
 */
const INTEGRATION_SECRET_KEYS = [
  'secret',
  'cookies',
  'token',
  'password',
  'passwordHash',
  'apiKey',
  'authValue',
] as const;

const NOT_FOUND =
  'Integration account not found — call list_integration_accounts to find the id.';

/**
 * Integration accounts from the chat (CLEAN-109). What the console's
 * Integrations page does — see which services exist, connect one, ask the
 * person to log in, disconnect — an agent can now do for the user it acts
 * for, through the same `IntegrationService` the controller calls. The
 * catalogue check, the (user, service, accountKey) idempotency and the
 * mechanism rules stay in the service; nothing is re-implemented here.
 *
 * The credential itself never passes through these tools: cookies arrive
 * via the Ranch extension, secret values via the console. A login request
 * returns what the person needs to complete it (site URL, help page,
 * instructions) — that is for the person, and fine to forward.
 */
@Injectable()
export class IntegrationTool {
  constructor(private readonly service: IntegrationService) {}

  @Tool({
    name: 'list_integration_catalogue',
    topic: ToolTopics.Browser,
    title: 'Available integrations',
    template: 'Which integrations can I connect?',
    description:
      'List the services Ranch can connect to: the stable service key, the title, and whether it is a browser login (cookies via the Ranch extension) or a secret (an API key entered in the console). Use the service key with create_integration_account.',
    parameters: z.object({}),
  })
  async listIntegrationCatalogue(
    _args: Record<string, never>,
    _context: unknown,
    _httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    return ok(this.service.listCatalogue());
  }

  @Tool({
    name: 'list_integration_accounts',
    topic: ToolTopics.Browser,
    title: 'My integration accounts',
    template: 'Which integration accounts does user «user» have?',
    description:
      'List the integration accounts connected for the user: id, service, accountKey, label, mechanism and status (pending, connected, needs_login, revoked). Never includes cookies or secret values. Use the id with request_integration_login or delete_integration_account.',
    parameters: z.object({ userId: userIdParam }),
  })
  async listIntegrationAccounts(
    { userId }: { userId: string },
    _context: unknown,
    _httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    return ok(this.present(await this.service.listAccounts(userId)));
  }

  @Tool({
    name: 'create_integration_account',
    topic: ToolTopics.Browser,
    title: 'Connect an integration account',
    template: 'Connect my «service» account «label»',
    description:
      'Start connecting an account on a catalogue service for the user. Idempotent on (userId, service, accountKey): calling again returns the existing row. The account stays "pending" until the credential is stored — for a browser service call request_integration_login next; for a secret service the person enters the value in the console. Returns the account without any credential.',
    parameters: z.object({
      userId: userIdParam,
      service: z
        .string()
        .min(1)
        .max(40)
        .describe('Service key from list_integration_catalogue.'),
      accountKey: accountKeyParam,
      label: z
        .string()
        .max(120)
        .optional()
        .describe('Human-friendly label shown in the console.'),
    }),
  })
  async createIntegrationAccount(
    {
      userId,
      service,
      accountKey,
      label,
    }: { userId: string; service: string; accountKey: string; label?: string },
    _context: unknown,
    _httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    try {
      const account = await this.service.connect(
        userId,
        service,
        accountKey,
        label,
      );
      return ok(this.present(account));
    } catch (e) {
      // Unknown service key: the service names the catalogue, the tool
      // names the tool that reads it.
      if (e instanceof BadRequestException) {
        return err(
          `${e.message} Call list_integration_catalogue and use one of its service keys.`,
        );
      }
      throw e;
    }
  }

  @Tool({
    name: 'request_integration_login',
    topic: ToolTopics.Browser,
    title: 'Ask for a login',
    template: 'Ask me to log in to «service»',
    description:
      'Get what the person needs to log in to a browser-mechanism integration: the site URL, a help page and step-by-step instructions (log in in their own Chrome, send cookies via the Ranch extension). Forward these to the person; the account flips to "connected" once the extension posts the cookies. Only for browser services — a secret service takes its value in the console. Find the account id with list_integration_accounts.',
    parameters: z.object({
      userId: userIdParam,
      id: z.string().min(1).describe('Integration account id.'),
    }),
  })
  async requestIntegrationLogin(
    { userId, id }: { userId: string; id: string },
    _context: unknown,
    _httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    try {
      return ok(await this.service.openLogin(userId, id));
    } catch (e) {
      if (e instanceof NotFoundException) return ok({ error: NOT_FOUND });
      if (e instanceof BadRequestException) {
        return err(
          `${e.message} A secret-mechanism account takes its value in the console's Integrations page.`,
        );
      }
      throw e;
    }
  }

  @Tool({
    name: 'delete_integration_account',
    topic: ToolTopics.Browser,
    title: 'Disconnect an account',
    template: 'Disconnect my «service» account',
    destructive: true,
    description:
      'Disconnect an integration account for the user: removes the row and wipes its stored credential (browser cookies or the secret value). Agents that used the «service:accountKey» profile lose access. Find the id with list_integration_accounts. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      userId: userIdParam,
      id: z.string().min(1).describe('Integration account id.'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteIntegrationAccount(
    args: { userId: string; id: string; confirm?: boolean },
    _context: unknown,
    _httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    const { userId, id } = args;
    // Resolve first so a wrong id is reported as such, not as a refusal to
    // delete something that does not exist.
    let account: IIntegrationAccountData;
    try {
      account = await this.service.getAccount(userId, id);
    } catch (e) {
      if (e instanceof NotFoundException) return ok({ error: NOT_FOUND });
      throw e;
    }

    const refusal = confirmed(
      args,
      `disconnect the ${account.service} account «${this.displayName(account)}» and wipe its stored credential`,
    );
    if (refusal) return refusal;

    await this.service.disconnect(userId, id);
    return ok({
      ok: true,
      id,
      service: account.service,
      accountKey: account.accountKey,
      message: `Disconnected ${account.service} account «${this.displayName(account)}».`,
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private present<T>(rows: T): T {
    return stripSecrets(rows, INTEGRATION_SECRET_KEYS);
  }

  private displayName(account: IIntegrationAccountData): string {
    return account.label ?? account.accountKey;
  }
}
