import type {
  ISecretEntry,
  ISecretListData,
  SecretProviderTypes,
} from '../domain/agentSecret.types';

/** Maps the secrets API onto the domain shape; reads defensively. */
export class AgentSecretMapper {
  toListData(raw: unknown): ISecretListData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      provider: this.toProvider(o.provider),
      secrets: Array.isArray(o.secrets)
        ? o.secrets
            .map((s) => this.toEntry(s))
            .filter((s): s is ISecretEntry => s !== null)
        : [],
    };
  }

  private toProvider(raw: unknown): SecretProviderTypes {
    return raw === 'aws' ? 'aws' : 'file';
  }

  private toEntry(raw: unknown): ISecretEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.name !== 'string') return null;
    return {
      name: o.name,
      value: typeof o.value === 'string' ? o.value : '',
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    };
  }
}
