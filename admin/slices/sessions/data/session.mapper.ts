import type {
  ISessionData,
  SessionStatusTypes,
} from '../domain/session.types';

const STATUSES = new Set<SessionStatusTypes>([
  'pending',
  'connected',
  'needs_login',
  'revoked',
]);

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Maps the integration-accounts API onto domain shapes; reads defensively. */
export class SessionMapper {
  toList(raw: unknown): ISessionData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((s): s is ISessionData => s !== null);
  }

  private toEntity(raw: unknown): ISessionData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      userId: str(o.userId),
      service: str(o.service),
      accountKey: str(o.accountKey),
      mechanism: o.mechanism === 'secret' ? 'secret' : 'browser',
      label: typeof o.label === 'string' ? o.label : null,
      status: STATUSES.has(o.status as SessionStatusTypes)
        ? (o.status as SessionStatusTypes)
        : 'pending',
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
  }
}
