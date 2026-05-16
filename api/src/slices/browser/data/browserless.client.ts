import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(BrowserlessClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  // Internal WS endpoint — Playwright `chromium.connect()` target. Browserless
  // v2 exposes `/chromium/playwright` for connections that respect a `launch`
  // query param (which is how we pass --user-data-dir per tenant).
  private get internalBase(): string {
    return this.config.get(
      'BROWSER_POOL_INTERNAL_URL',
      'ws://browser-pool.platform.svc.cluster.local:3000',
    );
  }

  private get internalPlaywrightPath(): string {
    return this.config.get(
      'BROWSER_POOL_PLAYWRIGHT_PATH',
      '/chromium/playwright',
    );
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
   * Build the Playwright WS endpoint for `chromium.connect()`. Profile path
   * embeds userId so two tenants can never share Chrome storage — even if
   * the pool is compromised, an attacker would need to forge a userId match
   * before the path collides with another user's profile.
   *
   * The `launch` query option is a browserless-specific extension; it is
   * honoured at `/chromium/playwright` (v2) and ignored at the bare CDP
   * endpoint. Use `chromium.connect({ wsEndpoint })` in the runtime, NOT
   * `connectOverCDP`.
   */
  buildCdpUrl(userId: string, accountKey: string): string {
    const profilePath = this.profilePath(userId, accountKey);
    // Playwright refuses `--user-data-dir` as a CLI arg in launch() — it
    // demands `launchPersistentContext(userDataDir, options)`. browserless
    // exposes this as the top-level `userDataDir` launch option, so the
    // arg list stays clean and the path goes through the right code path.
    const launch = {
      userDataDir: profilePath,
      args: [
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
    return `${this.internalBase}${this.internalPlaywrightPath}?${query.toString()}`;
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
    const safeAccount = this.slug(accountKey);
    if (!userId || !safeAccount) {
      throw new Error('Refusing to build profile path with empty segments');
    }
    return `/profiles/${userId}/${safeAccount}`;
  }

  // Conservative slug — accountKey is user-provided ("instagram:miybot"),
  // so anything outside [a-z0-9_:-] gets stripped before it ever touches
  // a filesystem path.
  private slug(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_:\-]/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
