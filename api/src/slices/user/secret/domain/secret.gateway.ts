import { IUserSecretListData } from './secret.types';

/**
 * Per-user secret store.
 *
 * Holds credentials a user has linked to their account via the integration
 * slice — typically API keys for OpenAI / GitHub / Stripe / etc. Distinct
 * from `agent/secret` (which is per-agent and managed by the agent itself)
 * because user-level secrets follow the user across all their agents.
 *
 * Storage layout mirrors agent/secret intentionally: one JSON blob per
 * scope, backed by AWS Secrets Manager or S3, switched by the same
 * `secret_provider` setting.
 */
export abstract class IUserSecretGateway {
  abstract list(userId: string): Promise<IUserSecretListData>;
  abstract get(userId: string, key: string): Promise<string | null>;
  abstract set(userId: string, key: string, value: string): Promise<void>;
  abstract delete(userId: string, key: string): Promise<void>;
}
