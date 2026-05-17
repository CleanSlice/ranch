import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Thin URL/token builder around the browserless v2 pool. We don't talk to
 * browserless's REST API for session lifecycle — instead we construct a
 * CDP-over-WebSocket URL that includes the per-session launch args
 * (notably --user-data-dir, which is what keeps tenants isolated). The
 * runtime calls `playwright.chromium.connectOverCDP(cdpUrl)` and the pool
 * spawns Chrome with those args on connect.
 */
@Injectable()
export class BrowserlessClient {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  // Internal WS endpoint — runtime opens this via Playwright's
  // `chromium.connectOverCDP()`. We deliberately use `/chromium` (raw CDP
  // route, Puppeteer-backed launcher) rather than `/chromium/playwright`:
  // the latter routes through Playwright's launchServer which forbids
  // `--user-data-dir` in launch args, breaking persistent profiles.
  private get internalBase(): string {
    return this.config.get(
      'BROWSER_POOL_INTERNAL_URL',
      'ws://browser-pool.platform.svc.cluster.local:3000',
    );
  }

  private get internalCdpPath(): string {
    return this.config.get('BROWSER_POOL_CDP_PATH', '/chromium');
  }

  // Public host — only used for live VNC URLs humans open in a browser.
  private get publicBase(): string {
    return this.config.get(
      'BROWSER_POOL_PUBLIC_URL',
      'https://browser.ranch.cleanslice.org',
    );
  }

  // Template path appended to publicBase for the live view. Default matches
  // browserless v2 self-hosted `/live?id=...&token=...`. If you ever swap to
  // a different image (steel-browser, Browserbase, custom noVNC), override
  // `BROWSER_POOL_VNC_URL_TEMPLATE` instead of editing this file.
  // Placeholders: {sessionId}, {token}.
  private get vncUrlTemplate(): string {
    return this.config.get(
      'BROWSER_POOL_VNC_URL_TEMPLATE',
      '/live?id={sessionId}&token={token}',
    );
  }

  private get token(): string {
    const t = this.config.get<string>('BROWSER_POOL_TOKEN');
    if (!t) {
      throw new Error(
        'BROWSER_POOL_TOKEN missing — set it in ranch-secrets so the API can mint browser URLs.',
      );
    }
    return t;
  }

  /**
   * Build the raw CDP WS endpoint. Profile path embeds userId so two
   * tenants can never share Chrome storage — even if the pool is
   * compromised, an attacker would need to forge a userId match before
   * the path collides with another user's profile.
   *
   * Use `chromium.connectOverCDP(wsEndpoint)` in the runtime — the
   * `/chromium` route uses Puppeteer's launcher, which accepts
   * `--user-data-dir` cleanly (Playwright's launcher would reject it).
   */
  buildCdpUrl(userId: string, accountKey: string): string {
    const profilePath = this.profilePath(userId, accountKey);
    const launch = {
      args: [
        `--user-data-dir=${profilePath}`,
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
      headless: false,
      stealth: true,
    };
    const query = new URLSearchParams({
      token: this.token,
      launch: JSON.stringify(launch),
    });
    return `${this.internalBase}${this.internalCdpPath}?${query.toString()}`;
  }

  /**
   * Sign a short-lived JWT scoped to one session and return a URL the user
   * can open in a browser to drive the running Chrome over VNC. Used for
   * 2FA / CAPTCHA flows where the agent can't proceed without a human.
   *
   * The path comes from BROWSER_POOL_VNC_URL_TEMPLATE so a deploy can
   * swap the image (browserless, steel-browser, etc.) without code changes.
   */
  buildVncUrl(userId: string, sessionId: string): string {
    const token = this.jwt.sign(
      { sub: userId, sid: sessionId, scope: 'browser:vnc' },
      { expiresIn: '15m' },
    );
    const path = this.vncUrlTemplate
      .replace('{sessionId}', encodeURIComponent(sessionId))
      .replace('{token}', encodeURIComponent(token));
    return `${this.publicBase}${path.startsWith('/') ? path : '/' + path}`;
  }

  /**
   * Single source of truth for where a tenant's profile lives. Centralized
   * here so no controller, mapper, or runtime can construct it from raw
   * user input — userId always comes from JWT context one frame up.
   */
  profilePath(userId: string, accountKey: string): string {
    const safeAccount = BrowserlessClient.slug(accountKey);
    if (!userId || !safeAccount) {
      throw new Error('Refusing to build profile path with empty segments');
    }
    return `/profiles/${userId}/${safeAccount}`;
  }

  // Conservative slug — accountKey is user-provided ("instagram:miybot"),
  // so anything outside [a-z0-9_:-] gets stripped before it ever touches
  // a filesystem path. Pure transform, declared static so eslint's
  // unbound-method rule doesn't flag the call site.
  private static slug(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_:-]/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
