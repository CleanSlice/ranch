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
 * The admin (JWT) path is userId-scoped — userId comes from the
 * authenticated request. The runtime path is instance-global (findGlobal)
 * — the runtime has no per-user identity, only the bridle key.
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
   * Every integration account in the instance, no userId filter. Used by
   * the runtime-facing resolvers — the runtime is authenticated by the
   * bridle key, has no per-user identity, and acts on the whole instance.
   * When `service` is given, narrows the result.
   */
  abstract findGlobal(service?: string): Promise<IIntegrationAccountData[]>;

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
