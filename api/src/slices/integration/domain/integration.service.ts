import {
  BadRequestException,
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
 * Orchestrates integration operations across three storage boundaries:
 *
 *  - IntegrationAccount row (Prisma, this slice)        — lifecycle/metadata
 *  - per-user browser-state store (user/browserState)   — cookies
 *  - per-user secret store (user/secret slice)          — API keys / tokens
 *
 * Two access paths:
 *
 *  - **admin (JWT)** — scoped to `req.user.sub`. The admin connects,
 *    lists and removes accounts owned by their ranch user.
 *  - **runtime (bridle key)** — instance-global. The agent runtime has
 *    no per-user identity; it lists every integration and dereferences
 *    each account's own `userId` to read the underlying cookie/secret
 *    store. No identity matching, no fan-out.
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
  ): Promise<IIntegrationAccountData> {
    const item = this.requireCatalogueItem(service);

    const existing = await this.gateway.findByServiceAccount(
      userId,
      service,
      accountKey,
    );
    if (existing) return this.syncStatus(existing);

    return this.gateway.create({
      userId,
      service,
      accountKey,
      mechanism: item.mechanism,
      label: label ?? null,
    });
  }

  /**
   * Returns the instructions the agent forwards to the end user when a
   * browser-mechanism integration needs cookies (first connect, or
   * cookies expired). No VNC, no pool — the user logs in to the
   * service in their own Chrome and pushes cookies via the Ranch
   * extension.
   */
  async openLogin(userId: string, id: string): Promise<ILoginInstructionData> {
    const account = await this.requireAccount(userId, id);
    if (account.mechanism !== 'browser') {
      throw new BadRequestException(
        `Service "${account.service}" uses mechanism "${account.mechanism}". Login flow is only available for browser-mechanism services.`,
      );
    }
    const item = this.requireCatalogueItem(account.service);
    return this.buildLoginInstructions(
      { accountId: account.id, accountKey: account.accountKey },
      item,
    );
  }

  /**
   * Same as openLogin but resolves by (service, accountKey) — runtime
   * uses this when an agent tool returns needsLogin and only the
   * profile string ("x:dimzhuk") is known. Pure read: it returns the
   * help URL + instructions; the IntegrationAccount is created later,
   * on the fly, when the extension actually posts cookies.
   */
  async requestLoginByProfile(
    service: string,
    accountKey: string,
  ): Promise<ILoginInstructionData> {
    const item = this.requireCatalogueItem(service);
    if (item.mechanism !== 'browser') {
      throw new BadRequestException(
        `Service "${service}" uses mechanism "${item.mechanism}". Login instructions are only valid for browser-mechanism services.`,
      );
    }
    const existing = (await this.gateway.findGlobal(service)).find(
      (a) => a.accountKey === accountKey,
    );
    return this.buildLoginInstructions(
      { accountId: existing?.id ?? '', accountKey },
      item,
    );
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

    await this.secrets.set(account.userId, this.secretKey(account), value);
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
  ): Promise<IIntegrationAccountData> {
    const account = await this.connect(userId, service, accountKey);
    return this.importCookies(userId, account.id, cookies, origins, userAgent);
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
    await this.browserState.set(
      account.userId,
      this.browserAccountKey(account),
      payload,
    );

    return this.setStatus(userId, account.id, 'connected');
  }

  /**
   * Runtime discovery — every integration in the instance. The runtime's
   * `integration_list` tool exposes this so an agent picks the exact
   * `browser_play` profile (`<service>:<accountKey>`) instead of guessing.
   */
  listAllForRuntime(): Promise<IIntegrationAccountData[]> {
    return this.gateway.findGlobal();
  }

  /**
   * Runtime lookup — fetch the cookie state for a `<service>:<accountKey>`
   * profile. Finds the account, then reads the store under that account's
   * own userId. Returns null when nothing is connected for the profile.
   */
  async resolveBrowserState(
    profile: string,
  ): Promise<IUserBrowserStatePayload | null> {
    const account = await this.findAccountByProfile(profile);
    if (!account) return null;
    return this.browserState.get(account.userId, profile);
  }

  async disconnect(userId: string, id: string): Promise<void> {
    const account = await this.requireAccount(userId, id);

    if (account.mechanism === 'browser') {
      await this.browserState.delete(
        account.userId,
        this.browserAccountKey(account),
      );
    } else if (account.mechanism === 'secret') {
      await this.secrets.delete(account.userId, this.secretKey(account));
    }

    await this.gateway.delete(userId, id);
  }

  /**
   * Resolve every connected secret-mechanism integration into a flat env
   * map for the runtime. Multiple accounts on the same service: most
   * recently updated wins the bare env var; each is also surfaced under a
   * per-accountKey suffixed env var so workflows that need to pick can.
   */
  async resolveSecretsForRuntime(
    service?: string,
  ): Promise<Record<string, string>> {
    const accounts = (await this.gateway.findGlobal(service)).filter(
      (a) => a.mechanism === 'secret' && a.status === 'connected',
    );
    if (accounts.length === 0) return {};

    accounts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const env: Record<string, string> = {};
    const claimed = new Set<string>();
    for (const account of accounts) {
      const item = findCatalogueItem(account.service);
      if (!item?.secretEnvKey) continue;
      const value = await this.secrets.get(
        account.userId,
        this.secretKey(account),
      );
      if (value == null) continue;

      if (!claimed.has(item.secretEnvKey)) {
        env[item.secretEnvKey] = value;
        claimed.add(item.secretEnvKey);
      }
      const envAlias = `${item.secretEnvKey}_${account.accountKey
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toUpperCase()}`;
      env[envAlias] = value;
    }
    return env;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Resolve a `<service>:<accountKey>` profile string to its account. */
  private async findAccountByProfile(
    profile: string,
  ): Promise<IIntegrationAccountData | null> {
    const sep = profile.indexOf(':');
    if (sep === -1) return null;
    const service = profile.slice(0, sep);
    const accountKey = profile.slice(sep + 1);
    const matches = await this.gateway.findGlobal(service);
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
    target: { accountId: string; accountKey: string },
    item: IIntegrationCatalogueItem,
  ): ILoginInstructionData {
    const adminBase = (
      this.config?.get<string>('ADMIN_URL') ??
      this.config?.get<string>('ADMIN_BASE_URL') ??
      ''
    ).replace(/\/+$/, '');
    const path = '/sessions';
    const helpUrl = adminBase ? `${adminBase}${path}` : path;
    const siteUrl = item.loginUrl ?? '';

    const lines = [
      `Open ${siteUrl || item.title} and log in as @${target.accountKey}.`,
      'Click the Ranch Cookies extension icon and press "Send cookies".',
      `If you don't have the extension installed yet, the help page walks you through it: ${helpUrl}`,
    ];

    return {
      accountId: target.accountId,
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
