import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '#/setup/prisma';
import {
  BrowserSessionStatusTypes,
  IBrowserGateway,
  IBrowserSessionConnection,
  IBrowserSessionData,
  IFindBrowserSessionsFilter,
} from '../domain';
import { BrowserMapper } from './browser.mapper';
import { BrowserlessClient } from './browserless.client';
import { BrowserWarmerService } from './browser-warmer.service';
import { IFileGateway } from '#/agent/file/domain';

@Injectable()
export class BrowserGateway extends IBrowserGateway {
  private readonly logger = new Logger(BrowserGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: BrowserMapper,
    private readonly pool: BrowserlessClient,
    private readonly warmer: BrowserWarmerService,
    private readonly files: IFileGateway,
  ) {
    super();
  }

  async openSession(
    userId: string,
    accountKey: string,
    loginUrl?: string,
  ): Promise<IBrowserSessionConnection> {
    // Canonicalise so `Instagram` and `instagram` collapse onto one
    // session row + one S3 state file. Without this the upsert below
    // and the pool's profilePath diverge per case variant — that's how
    // `admin-instagram.json` and `admin-Instagram.json` ended up living
    // side by side in S3.
    accountKey = BrowserGateway.canonicalAccountKey(accountKey);
    // Upsert is intentional — repeated `openSession` for the same
    // (userId, accountKey) must reuse the same profile path. A new row
    // every call would orphan cookies on the PVC.
    const record = await this.prisma.browserSession.upsert({
      where: { userId_accountKey: { userId, accountKey } },
      create: this.mapper.toCreate({ userId, accountKey }),
      update: {
        lastUsedAt: new Date(),
        status: BrowserSessionStatusTypes.Active,
      },
    });

    const session = this.mapper.toEntity(record);
    const cdpUrl = this.pool.buildCdpUrl(userId, accountKey);

    // Warm via the API-local pool URL (matters in dev where api runs on
    // the host and the pool container's docker hostname isn't resolvable).
    // The CDP URL we return to callers still uses internalBase so the
    // runtime, which lives inside the cluster's docker network, can reach
    // it by service name.
    //
    // Fall back to a per-service known login URL if the caller didn't pass
    // one — agents often forget the parameter and we'd rather hand the
    // user a usable VNC view than a stack of about:blank tabs.
    const effectiveLoginUrl =
      loginUrl ?? BrowserGateway.defaultLoginUrl(accountKey);
    const warmed = await this.warmer.warm(
      session.id,
      this.pool.buildWarmCdpUrl(userId, accountKey),
      effectiveLoginUrl,
    );
    if (!warmed.ok) {
      this.logger.warn(
        `Could not warm Chrome for ${session.id}: ${warmed.error} (vncUrl will render blank until the user navigates manually)`,
      );
    }

    return {
      session,
      cdpUrl,
      vncUrl: this.pool.buildVncUrl(userId, session.id),
    };
  }

  async closeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.requireOwned(userId, sessionId);
    this.warmer.release(session.id);
    await this.prisma.browserSession.update({
      where: { id: session.id },
      data: {
        status: BrowserSessionStatusTypes.Idle,
        lastUsedAt: new Date(),
      },
    });
  }

  async resetSession(
    userId: string,
    sessionId: string,
  ): Promise<IBrowserSessionConnection> {
    const session = await this.requireOwned(userId, sessionId);
    // Drop the warm hold so the current Chrome dies; openSession() below
    // re-warms on the same profile path. Flip status in between so the
    // admin UI shows "idle" instead of a stale "stuck" state.
    this.warmer.release(session.id);
    await this.prisma.browserSession.update({
      where: { id: session.id },
      data: {
        status: BrowserSessionStatusTypes.Idle,
        lastUsedAt: new Date(),
      },
    });
    return this.openSession(userId, session.accountKey);
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.requireOwned(userId, sessionId);
    this.warmer.release(session.id);
    await this.prisma.browserSession.delete({ where: { id: session.id } });
    // Wiping the on-disk profile is handled by a separate cleanup CronJob
    // (Phase 4) — we don't block the user-facing request on a network call
    // to the pool that may fail.
    this.logger.log(
      `Marked profile ${this.pool.profilePath(userId, session.accountKey)} for cleanup`,
    );
  }

  async setStatus(
    userId: string,
    sessionId: string,
    status: BrowserSessionStatusTypes,
  ): Promise<IBrowserSessionData> {
    await this.requireOwned(userId, sessionId);
    const updated = await this.prisma.browserSession.update({
      where: { id: sessionId },
      data: { status, lastUsedAt: new Date() },
    });
    return this.mapper.toEntity(updated);
  }

  async findAll({
    userId,
    status,
  }: IFindBrowserSessionsFilter): Promise<IBrowserSessionData[]> {
    const rows = await this.prisma.browserSession.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((r) => this.mapper.toEntity(r));
  }

  async findById(
    userId: string,
    sessionId: string,
  ): Promise<IBrowserSessionData | null> {
    const row = await this.prisma.browserSession.findFirst({
      where: { id: sessionId, userId },
    });
    return row ? this.mapper.toEntity(row) : null;
  }

  async mintVncUrl(userId: string, sessionId: string): Promise<string | null> {
    const session = await this.findById(userId, sessionId);
    if (!session) return null;
    return this.pool.buildVncUrl(userId, sessionId);
  }

  async harvestStorageState(userId: string, sessionId: string) {
    await this.requireOwned(userId, sessionId);
    const res = await this.warmer.harvestCookies(sessionId);
    if (!res.ok) {
      // 500 is the right semantic here — the session exists, the user is
      // authorised, but the pool didn't cough up the cookies. Caller can
      // retry after re-opening the session.
      throw new Error(`Harvest failed: ${res.error}`);
    }
    // localStorage harvest is intentionally skipped — see cookieHarvest.ts
    // in the runtime for the rationale (per-origin attach round-trips, and
    // login cookies cover what we need for auth).
    return { cookies: res.cookies, origins: [] };
  }

  async expireIdleSessions(idleMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - idleMinutes * 60_000);
    const result = await this.prisma.browserSession.updateMany({
      where: {
        lastUsedAt: { lt: cutoff },
        status: {
          notIn: [
            BrowserSessionStatusTypes.Expired,
            BrowserSessionStatusTypes.NeedsLogin,
          ],
        },
      },
      data: { status: BrowserSessionStatusTypes.Expired },
    });
    if (result.count > 0) {
      this.logger.log(
        `Marked ${result.count} browser session(s) expired (idle > ${idleMinutes}m)`,
      );
    }
    return result.count;
  }

  async importStorageState(
    rancherUserId: string,
    agentId: string,
    userId: string,
    profile: string,
    cookies: unknown[],
    origins: unknown[] = [],
    userAgent?: string,
  ) {
    // Runtime composes the same path as BrowserGateway here in
    // playwright.repository.localStatePath / browserLogin.repository.
    // Keep the sanitization regex AND the lowercase step in sync —
    // diverging means the file would land at a path the agent never
    // looks at, or split into case variants the way the legacy
    // admin-instagram.json / admin-Instagram.json files did.
    profile = BrowserGateway.canonicalAccountKey(profile);
    const safeUser = userId.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const path = `browser-state/${safeUser}-${profile}.json`;
    // Wrap format when userAgent is supplied so the runtime can replay
    // the SAME browser fingerprint that issued the cookies (Instagram
    // and friends invalidate sessions whose UA shifts between Mac Chrome
    // and Linux HeadlessChrome). Plain `{cookies, origins}` is preserved
    // for back-compat with state files that pre-dated this change.
    const payload = userAgent
      ? { userAgent, storageState: { cookies, origins } }
      : { cookies, origins };
    await this.files.save(agentId, path, JSON.stringify(payload, null, 2));
    // Mirror the import as a BrowserSession row so the admin UI shows
    // "you have cookies for X profile" in the same place pool sessions
    // appear. Same (userId, accountKey) upsert convention used by
    // openSession — repeated imports refresh lastUsedAt instead of
    // stacking rows.
    await this.prisma.browserSession.upsert({
      where: {
        userId_accountKey: { userId: rancherUserId, accountKey: profile },
      },
      create: this.mapper.toCreate({
        userId: rancherUserId,
        accountKey: profile,
      }),
      update: {
        lastUsedAt: new Date(),
        status: BrowserSessionStatusTypes.Idle,
      },
    });
    this.logger.log(
      `Imported ${cookies.length} cookies into ${agentId}:${path}${userAgent ? ' (with UA)' : ''}`,
    );
    return { path, cookies: cookies.length };
  }

  /**
   * Single source of truth for "what does this accountKey look like on
   * disk and in the DB". Lowercase + the same character whitelist as
   * the legacy regex, so two callers passing `Instagram` and
   * `instagram` end up upserting one BrowserSession row and writing one
   * S3 file. Mirrored in user/browserState.gateway.ts and the runtime's
   * browserLogin.repository — keep all three in sync.
   */
  static canonicalAccountKey(accountKey: string): string {
    return accountKey.toLowerCase().replace(/[^a-z0-9_:.-]/g, '_');
  }

  /**
   * Map an accountKey to the canonical login URL of the corresponding
   * service so the VNC view lands on something useful when the caller
   * forgot to pass loginUrl. The service token is read from the prefix
   * before the first `:` (case-insensitive) — so `instagram`,
   * `instagram:miybot`, and `INSTAGRAM:foo` all match.
   *
   * Add new mappings here when a new vertical (TikTok, Reddit, etc.)
   * shows up; don't sprinkle them across callers.
   */
  static defaultLoginUrl(accountKey: string): string {
    // Agents pass accountKey in a few shapes: "instagram", "instagram:miybot",
    // "instagram_miybot_v3", "instagram-test". Match by the service name
    // appearing as a token at the start of the slug — split on anything
    // that's not a lowercase letter, take the first non-empty chunk. Then
    // try a prefix match against our known list so "facebook_ads_main" and
    // "facebook:main" both land on facebook.
    const normalized = accountKey.toLowerCase();
    const head = normalized.split(/[^a-z]+/).filter(Boolean)[0] ?? '';

    // Order matters: longer / more specific matches win — facebook_ads
    // before facebook so "facebookads…" doesn't degrade to plain fb login.
    const matchers: Array<[RegExp, string]> = [
      [/^facebook_?ads/, 'https://www.facebook.com/login/'],
      [/^(facebook|meta)/, 'https://www.facebook.com/login/'],
      [/^instagram/, 'https://www.instagram.com/accounts/login/'],
      [/^(twitter|x)$/, 'https://x.com/login'],
      [/^twitter/, 'https://x.com/login'],
      [/^paypal/, 'https://www.paypal.com/signin'],
      [/^linkedin/, 'https://www.linkedin.com/login'],
      [/^(google|gmail|youtube)/, 'https://accounts.google.com/'],
      [/^stripe/, 'https://dashboard.stripe.com/login'],
      [/^github/, 'https://github.com/login'],
      [/^tiktok/, 'https://www.tiktok.com/login'],
    ];
    for (const [re, url] of matchers) {
      if (re.test(normalized) || re.test(head)) return url;
    }
    return 'about:blank';
  }

  // Returns the session if owned by userId; otherwise throws 404 (we don't
  // distinguish "not yours" from "not found" so we don't leak existence).
  private async requireOwned(
    userId: string,
    sessionId: string,
  ): Promise<IBrowserSessionData> {
    const session = await this.findById(userId, sessionId);
    if (!session) {
      throw new NotFoundException(`Browser session ${sessionId} not found`);
    }
    if (session.userId !== userId) {
      // Belt and suspenders — findById already filters by userId, but if
      // someone refactors that later this throws explicitly before any
      // browser-pool URL gets minted.
      throw new ForbiddenException();
    }
    return session;
  }
}
