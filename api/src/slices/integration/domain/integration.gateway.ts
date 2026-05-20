import {
  IIntegrationAccountData,
  ICreateIntegrationAccountData,
  IUpdateIntegrationAccountData,
} from './integration.types';

/**
 * Integration gateway — persistence-only contract for IntegrationAccount
 * rows. All cross-slice orchestration (browser-pool, secret-store) lives
 * in IntegrationService, not here, so the gateway stays a thin Prisma
 * wrapper that can be unit-tested without touching browser/secret slices.
 *
 * Every method is userId-scoped: rows from one user must never leak into
 * another's response. userId comes from the authenticated request — never
 * from request body.
 */
export abstract class IIntegrationGateway {
  abstract findAll(userId: string): Promise<IIntegrationAccountData[]>;

  abstract findById(
    userId: string,
    id: string,
  ): Promise<IIntegrationAccountData | null>;

  abstract findByServiceAccount(
    userId: string,
    service: string,
    accountKey: string,
  ): Promise<IIntegrationAccountData | null>;

  /**
   * Find every account that an identity can act as — either as its
   * canonical owner (`userId == identityId`) or via an alias
   * (`identityId IN aliases`). Used by runtime-facing resolvers where
   * the caller is `ctx.from` (Telegram ID / "admin" / channel ID) and
   * may not match the canonical owner.
   *
   * When `service` is given, narrows the result. Used by the secrets
   * resolver to fetch only e.g. "openai" rows.
   */
  abstract findByIdentity(
    identityId: string,
    service?: string,
  ): Promise<IIntegrationAccountData[]>;

  abstract create(
    data: ICreateIntegrationAccountData,
  ): Promise<IIntegrationAccountData>;

  abstract update(
    userId: string,
    id: string,
    data: IUpdateIntegrationAccountData,
  ): Promise<IIntegrationAccountData>;

  abstract delete(userId: string, id: string): Promise<void>;
}
