import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IUserSecretGateway } from '#/user/secret/domain';
import {
  IUserBrowserStateGateway,
  IUserBrowserStatePayload,
} from '#/user/browserState/domain';
import { IIntegrationGateway } from './integration.gateway';
import { findCatalogueItem, INTEGRATION_CATALOGUE } from './catalogue';
import {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
  ILoginInstructionData,
  IntegrationStatusTypes,
} from './integration.types';

/**
 * Orchestrates user-facing integration operations across three storage
 * boundaries:
 *
 *  - IntegrationAccount row (Prisma, this slice)        — lifecycle/metadata
 *  - BrowserSession        (browser slice)              — cookies + profile
 *  - per-user secret store (user/secret slice)          — API keys / tokens
 *
 * The runtime never talks to those underlying stores directly for
 * integrations — it asks this service via the internal controller, so
 * resolution rules (which account is "active", how envKey is derived)
 * stay in one place.
 *
 * ## Aliases (the userId-mismatch fix)
 *
 * The admin UI authenticates as a ranch-user UUID. The runtime resolves
 * resources by `ctx.from`, which is a Telegram chat ID, the literal
 * "admin", or some channel-specific ID — never the UUID. To bridge
 * these without rewriting auth, each IntegrationAccount carries an
 * `aliases: string[]` list of alternate identities. On every write
 * (cookies, secret), this service fans the same payload out to the
 * canonical userId path AND every alias path. On disconnect or alias
 * removal, the corresponding alias paths are cleaned up. The runtime
 * keeps doing direct `userId == identityId` lookups against the
 * underlying stores — no special-casing needed there.
 */
@Injectable()
export class IntegrationService {
  constructor(
    private gateway: IIntegrationGateway,
    private secrets: IUserSecretGateway,
    private browserState: IUserBrowserStateGateway,
    @Optional() private config?: ConfigService,
  ) {}

  listCatalogue(): IIntegrationCatalogueItem[] {
    return INTEGRATION_CATALOGUE;
  }

  async listAccounts(userId: string): Promise<IIntegrationAccountData[]> {
    const accounts = await this.gateway.findAll(userId);
    return Promise.all(accounts.map((account) => this.syncStatus(account)));
  }

  async getAccount(
    userId: string,
    id: string,
  ): Promise<IIntegrationAccountData> {
    const account = await this.requireAccount(userId, id);
    return this.syncStatus(account);
  }

  async connect(
    userId: string,
    service: string,
    accountKey: string,
    label?: string,
    aliases?: string[],
  ): Promise<IIntegrationAccountData> {
    const item = this.requireCatalogueItem(service);

    const existing = await this.gateway.findByServiceAccount(
      userId,
      service,
      accountKey,
    );
    if (existing) {
      // If the caller supplied a non-empty aliases list, merge it into
      // the row — connecting twice with new aliases should be additive
      // (not destructive), so users can paste a cookies dump and add a
      // new Telegram ID in the same step.
      if (aliases && aliases.length > 0) {
        const merged = Array.from(
          new Set([...existing.aliases, ...aliases]),
        ).filter((a) => a !== existing.userId);
        if (merged.length !== existing.aliases.length) {
          return this.updateAliases(userId, existing.id, merged);
        }
      }
      return this.syncStatus(existing);
    }

    return this.gateway.create({
      userId,
      service,
      accountKey,
      mechanism: item.mechanism,
      label: label ?? null,
      aliases,
    });
  }

  /**
   * Returns the instructions the agent forwards to the end user when a
   * browser-mechanism integration needs cookies (first connect, or
   * cookies expired). No VNC, no pool — the user logs in to the
   * service in their own Chrome and pushes cookies via the Ranch
   * extension (or pastes them manually).
   */
  async openLogin(
    userId: string,
    id: string,
  ): Promise<ILoginInstructionData> {
    const account = await this.requireAccount(userId, id);
    if (account.mechanism !== 'browser') {
      throw new BadRequestException(
        `Service "${account.service}" uses mechanism "${account.mechanism}". Login flow is only available for browser-mechanism services.`,
      );
    }
    const item = this.requireCatalogueItem(account.service);
    await this.setStatus(userId, account.id, 'needs_login');
    return this.buildLoginInstructions(account, item);
  }

  /**
   * Same as openLogin but resolves by (service, accountKey) — runtime
   * uses this when an agent tool returns needsLogin and only the
   * profile string ("x:dimzhuk") is known. Creates the
   * IntegrationAccount on the fly if missing so the user has somewhere
   * to send cookies to.
   */
  async requestLoginByProfile(
    identityId: string,
    service: string,
    accountKey: string,
  ): Promise<ILoginInstructionData> {
    const item = this.requireCatalogueItem(service);
    if (item.mechanism !== 'browser') {
      throw new BadRequestException(
        `Service "${service}" uses mechanism "${item.mechanism}". Login instructions are only valid for browser-mechanism services.`,
      );
    }

    // Prefer an existing account this identity can act as (owner or alias)
    // — without this check, a Telegram-driven agent would always create a
    // new row, duplicating the admin's UUID-owned account.
    const reachable = (await this.gateway.findByIdentity(identityId, service))
      .find((a) => a.accountKey === accountKey);

    const account = reachable
      ? await this.setStatus(reachable.userId, reachable.id, 'needs_login')
      : await this.connect(identityId, service, accountKey);

    if (!reachable) {
      await this.setStatus(identityId, account.id, 'needs_login');
    }
    return this.buildLoginInstructions(account, item);
  }

  async saveSecret(
    userId: string,
    id: string,
    value: string,
  ): Promise<IIntegrationAccountData> {
    const account = await this.requireAccount(userId, id);
    if (account.mechanism !== 'secret') {
      throw new BadRequestException(
        `Service "${account.service}" uses mechanism "${account.mechanism}". Use POST /login instead.`,
      );
    }

    const item = this.requireCatalogueItem(account.service);
    if (!item.secretEnvKey) {
      throw new BadRequestException(
        `Catalogue entry for "${account.service}" is missing secretEnvKey. This is a server-side configuration bug.`,
      );
    }

    const key = this.secretKey(account);
    // Fan-out: write the same value to every identity this account can be
    // accessed under. Runtime resolves secrets via per-identity stores,
    // so without this the value is only visible to the canonical owner.
    for (const identity of this.allIdentities(account)) {
      await this.secrets.set(identity, key, value);
    }
    return this.setStatus(userId, account.id, 'connected');
  }

  /**
   * Extension-driven one-shot: ensure an IntegrationAccount exists for
   * (service, accountKey), then write the imported cookies under it.
   */
  async connectAndImport(
    userId: string,
    service: string,
    accountKey: string,
    cookies: Parameters<IntegrationService['importCookies']>[2],
    origins?: Parameters<IntegrationService['importCookies']>[3],
    userAgent?: string,
    aliases?: string[],
  ): Promise<IIntegrationAccountData> {
    const account = await this.connect(
      userId,
      service,
      accountKey,
      undefined,
      aliases,
    );
    return this.importCookies(
      userId,
      account.id,
      cookies,
      origins,
      userAgent,
    );
  }

  async importCookies(
    userId: string,
    id: string,
    cookies: IUserBrowserStatePayload['storageState']['cookies'],
    origins?: IUserBrowserStatePayload['storageState']['origins'],
    userAgent?: string,
  ): Promise<IIntegrationAccountData> {
    const account = await this.requireAccount(userId, id);
    if (account.mechanism !== 'browser') {
      throw new BadRequestException(
        `Service "${account.service}" uses mechanism "${account.mechanism}". Cookie import is only available for browser-mechanism services.`,
      );
    }

    const payload: IUserBrowserStatePayload = {
      ...(userAgent ? { userAgent } : {}),
      storageState: { cookies, origins: origins ?? [] },
    };
    const profile = this.browserAccountKey(account);
    // Fan-out write to canonical + every alias. The runtime's fallback
    // does a direct path lookup by `ctx.from` — without the fan-out a
    // Telegram-driven agent would 404 even after a successful import.
    for (const identity of this.allIdentities(account)) {
      await this.browserState.set(identity, profile, payload);
    }

    return this.setStatus(userId, account.id, 'connected');
  }

  /**
   * Add or remove runtime identities this integration is available under.
   * New aliases get the current cookies/secret mirrored to them; removed
   * aliases get their copy wiped. Owner (`userId`) is never demoted to
   * an alias — sanitize drops it if present in the incoming list.
   */
  async updateAliases(
    userId: string,
    id: string,
    nextAliases: string[],
  ): Promise<IIntegrationAccountData> {
    const account = await this.requireAccount(userId, id);

    const currentSet = new Set(account.aliases);
    const nextSet = new Set(
      nextAliases.filter((a) => a && a.trim() !== '' && a !== account.userId),
    );

    const added = [...nextSet].filter((a) => !currentSet.has(a));
    const removed = [...currentSet].filter((a) => !nextSet.has(a));

    if (account.mechanism === 'browser') {
      const profile = this.browserAccountKey(account);
      // Snapshot the canonical-owner copy so newly added aliases get
      // the exact same payload (cookies + UA) the owner sees.
      const source = await this.browserState.get(account.userId, profile);
      if (source) {
        for (const a of added) await this.browserState.set(a, profile, source);
      }
      for (const a of removed) await this.browserState.delete(a, profile);
    } else if (account.mechanism === 'secret') {
      const key = this.secretKey(account);
      const source = await this.secrets.get(account.userId, key);
      if (source != null) {
        for (const a of added) await this.secrets.set(a, key, source);
      }
      for (const a of removed) await this.secrets.delete(a, key);
    }

    return this.gateway.update(userId, id, { aliases: [...nextSet] });
  }

  /**
   * Runtime lookup — fetches a state file for an identity that may be
   * the canonical owner OR an alias. Most of the time direct lookup
   * succeeds (we fan-out writes), but if the alias was added AFTER the
   * last import and `updateAliases` hasn't yet mirrored, fall through
   * to the canonical owner.
   */
  async resolveBrowserState(
    identityId: string,
    profile: string,
  ): Promise<IUserBrowserStatePayload | null> {
    const direct = await this.browserState.get(identityId, profile);
    if (direct) return direct;

    const owner = await this.findOwnerByIdentityAndProfile(
      identityId,
      profile,
    );
    if (!owner) return null;
    return this.browserState.get(owner.userId, profile);
  }

  async disconnect(userId: string, id: string): Promise<void> {
    const account = await this.requireAccount(userId, id);

    if (account.mechanism === 'browser') {
      const profile = this.browserAccountKey(account);
      for (const identity of this.allIdentities(account)) {
        await this.browserState.delete(identity, profile);
      }
    } else if (account.mechanism === 'secret') {
      const key = this.secretKey(account);
      for (const identity of this.allIdentities(account)) {
        await this.secrets.delete(identity, key);
      }
    }

    await this.gateway.delete(userId, id);
  }

  /**
   * Resolve the secret-mechanism integrations visible to an identity
   * into a flat env map. Identity matches canonical owner OR any alias.
   *
   * Multiple accounts on the same service: most recently updated wins
   * the bare env var, each is also surfaced under a per-accountKey
   * suffixed alias so workflows that need to pick can opt in.
   */
  async resolveSecretsForRuntime(
    identityId: string,
    service?: string,
  ): Promise<Record<string, string>> {
    const accounts = (await this.gateway.findByIdentity(identityId, service))
      .filter((a) => a.mechanism === 'secret' && a.status === 'connected');
    if (accounts.length === 0) return {};

    accounts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const env: Record<string, string> = {};
    const claimed = new Set<string>();
    for (const account of accounts) {
      const item = findCatalogueItem(account.service);
      if (!item?.secretEnvKey) continue;
      // Read the value under the SAME identity the runtime is asking on
      // behalf of — fan-out writes guarantee the entry exists here too.
      // Falls back to the canonical owner if the fan-out didn't reach
      // (e.g. alias added before updateAliases mirrored).
      const value =
        (await this.secrets.get(identityId, this.secretKey(account))) ??
        (await this.secrets.get(account.userId, this.secretKey(account)));
      if (value == null) continue;

      if (!claimed.has(item.secretEnvKey)) {
        env[item.secretEnvKey] = value;
        claimed.add(item.secretEnvKey);
      }
      const alias = `${item.secretEnvKey}_${account.accountKey
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toUpperCase()}`;
      env[alias] = value;
    }
    return env;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Canonical userId + every alias, deduped. Used for fan-out writes. */
  private allIdentities(account: IIntegrationAccountData): string[] {
    return Array.from(new Set([account.userId, ...account.aliases]));
  }

  private async findOwnerByIdentityAndProfile(
    identityId: string,
    profile: string,
  ): Promise<IIntegrationAccountData | null> {
    // profile is "<service>:<accountKey>" — split once so an accountKey
    // with a colon in it (rare but allowed by the validator) still
    // matches.
    const sep = profile.indexOf(':');
    if (sep === -1) return null;
    const service = profile.slice(0, sep);
    const accountKey = profile.slice(sep + 1);

    const matches = await this.gateway.findByIdentity(identityId, service);
    return matches.find((m) => m.accountKey === accountKey) ?? null;
  }

  private requireCatalogueItem(service: string): IIntegrationCatalogueItem {
    const item = findCatalogueItem(service);
    if (!item) {
      throw new BadRequestException(
        `Unknown service "${service}". See GET /integrations/catalogue for the list.`,
      );
    }
    return item;
  }

  private async requireAccount(
    userId: string,
    id: string,
  ): Promise<IIntegrationAccountData> {
    const account = await this.gateway.findById(userId, id);
    if (!account) throw new NotFoundException('Integration account not found');
    return account;
  }

  private browserAccountKey(account: IIntegrationAccountData): string {
    return `${account.service}:${account.accountKey}`;
  }

  private secretKey(account: IIntegrationAccountData): string {
    return `${account.service.toUpperCase()}__${account.accountKey.toUpperCase()}`;
  }

  /**
   * Browser-mechanism status is now driven by the extension's
   * import-state POST flipping the row to "connected". On read we
   * don't auto-rewrite anything — what we have in the DB is the
   * source of truth, kept fresh by writes.
   */
  private async syncStatus(
    account: IIntegrationAccountData,
  ): Promise<IIntegrationAccountData> {
    return account;
  }

  private buildLoginInstructions(
    account: IIntegrationAccountData,
    item: IIntegrationCatalogueItem,
  ): ILoginInstructionData {
    const adminBase = (
      this.config?.get<string>('ADMIN_URL') ??
      this.config?.get<string>('ADMIN_BASE_URL') ??
      ''
    ).replace(/\/+$/, '');
    const path = `/integrations/connect/${encodeURIComponent(account.id)}`;
    const helpUrl = adminBase ? `${adminBase}${path}` : path;
    const siteUrl = item.loginUrl ?? '';

    const lines = [
      `Open ${siteUrl || item.title} and log in as @${account.accountKey}.`,
      'Click the Ranch Cookies extension icon, switch to "Integration" mode if needed, and press "Send cookies".',
      `If you don't have the extension installed yet, the help page walks you through it: ${helpUrl}`,
    ];

    return {
      accountId: account.id,
      siteUrl,
      helpUrl,
      instructions: lines.join('\n'),
    };
  }

  private setStatus(
    userId: string,
    id: string,
    status: IntegrationStatusTypes,
  ): Promise<IIntegrationAccountData> {
    return this.gateway.update(userId, id, { status });
  }
}
