import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import { IBrowserGateway, BrowserSessionStatusTypes } from './domain';

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const ok = (value: unknown) => ({
  content: [{ type: 'text' as const, text: asText(value) }],
});

const accountKeyParam = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_:-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, dash',
  })
  .describe(
    'Account label scoped to the calling user, e.g. "instagram:miybot", "paypal:main".',
  );

const statusEnum = z.nativeEnum(BrowserSessionStatusTypes);

/**
 * MCP tools the runtime calls before/after `browser_play` to mediate access
 * to the shared browser pool. The agent never sees the CDP URL — that goes
 * back to the runtime over an authenticated channel. The VNC URL is the
 * one piece the agent CAN surface to the end user (e.g. forward it via
 * Telegram so they can finish a 2FA login).
 */
@Injectable()
export class BrowserTool {
  private readonly logger = new Logger(BrowserTool.name);

  constructor(private readonly gateway: IBrowserGateway) {}

  @Tool({
    name: 'browser_session_open',
    description:
      'Open or reuse a browser session for the given accountKey. Returns the session metadata and a VNC URL the user can open to finish a login manually. The runtime uses the returned cdpUrl internally — agents should not forward it anywhere. Pass loginUrl so the VNC view renders the right page immediately instead of about:blank.',
    parameters: z.object({
      userId: z
        .string()
        .describe('Owning user — must match the calling principal.'),
      accountKey: accountKeyParam,
      loginUrl: z
        .string()
        .url()
        .optional()
        .describe(
          "Page the pool's Chrome should land on before the user opens vncUrl (e.g. https://www.instagram.com/accounts/login/). Defaults to about:blank.",
        ),
    }),
  })
  async open({
    userId,
    accountKey,
    loginUrl,
  }: {
    userId: string;
    accountKey: string;
    loginUrl?: string;
  }) {
    return ok(await this.gateway.openSession(userId, accountKey, loginUrl));
  }

  @Tool({
    name: 'browser_session_close',
    description:
      'Close (release) a browser session. Profile data stays on disk.',
    parameters: z.object({
      userId: z.string(),
      sessionId: z.string(),
    }),
  })
  async close({ userId, sessionId }: { userId: string; sessionId: string }) {
    await this.gateway.closeSession(userId, sessionId);
    return ok({ ok: true, sessionId });
  }

  @Tool({
    name: 'browser_session_reset',
    description:
      'Hard-reset a stuck session (e.g. after browser_play timed out). Returns a fresh CDP URL on the same profile.',
    parameters: z.object({
      userId: z.string(),
      sessionId: z.string(),
    }),
  })
  async reset({ userId, sessionId }: { userId: string; sessionId: string }) {
    return ok(await this.gateway.resetSession(userId, sessionId));
  }

  @Tool({
    name: 'browser_session_login_url',
    description:
      'Mint a short-lived VNC URL the user can open in a browser to log in manually (e.g. for 2FA / CAPTCHA). Call this when openSession or browser_play indicates the profile is not authenticated, then forward the URL to the user via Telegram or chat.',
    parameters: z.object({
      userId: z.string(),
      sessionId: z.string(),
    }),
  })
  async loginUrl({ userId, sessionId }: { userId: string; sessionId: string }) {
    const vncUrl = await this.gateway.mintVncUrl(userId, sessionId);
    return ok({ vncUrl });
  }

  @Tool({
    name: 'browser_session_set_status',
    description:
      'Flip a session status flag — call after browser_play completes (idle / needs_login / stuck) so the admin UI reflects reality.',
    parameters: z.object({
      userId: z.string(),
      sessionId: z.string(),
      status: statusEnum,
    }),
  })
  async setStatus({
    userId,
    sessionId,
    status,
  }: {
    userId: string;
    sessionId: string;
    status: BrowserSessionStatusTypes;
  }) {
    return ok(await this.gateway.setStatus(userId, sessionId, status));
  }

  @Tool({
    name: 'browser_session_list',
    description: 'List browser sessions for a user.',
    parameters: z.object({
      userId: z.string(),
      status: statusEnum.optional(),
    }),
  })
  async list({
    userId,
    status,
  }: {
    userId: string;
    status?: BrowserSessionStatusTypes;
  }) {
    return ok(await this.gateway.findAll({ userId, status }));
  }
}
