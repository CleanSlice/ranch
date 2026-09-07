import type {
  IShareLinkState,
  IShareResolved,
} from '../domain/share.types';

/**
 * Maps the share-link API onto domain shapes.
 *
 * `ShareLinkDto` / `ShareResolvedDto` are not in the generated SDK yet (the API
 * side lands in a later task), so both inputs are read defensively from
 * `unknown` — the same treatment `AgentMapper` gives the agents endpoints.
 *
 * `url` is intentionally left `null` here: it is `${window.location.origin}/…`,
 * and the data layer has no business touching `window`. The store fills it in.
 */
export class ShareMapper {
  /**
   * Never `null`: "no link row yet" and "unreadable response" are both just
   * *not shared*, which is exactly what the owner panel renders. Keeping the
   * return total means the store's `Record<agentId, IShareLinkState>` never
   * holds a hole the UI has to special-case.
   */
  toState(raw: unknown): IShareLinkState {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const token =
      typeof o.token === 'string' && o.token.length > 0 ? o.token : null;
    // A link with no token is unusable even if the API called it active, so it
    // reads as not shared rather than as a link the owner cannot copy.
    const active = o.active === true && token !== null;
    return {
      active,
      token: active ? token : null,
      url: null,
      createdAt: this.toIsoOrNull(o.createdAt),
      revokedAt: this.toIsoOrNull(o.revokedAt),
      rotatedAt: this.toIsoOrNull(o.rotatedAt),
    };
  }

  toResolved(raw: unknown): IShareResolved | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.agentId !== 'string' || o.agentId.length === 0) return null;
    return {
      agentId: o.agentId,
      agentName: typeof o.agentName === 'string' ? o.agentName : '',
      agentStatus: typeof o.agentStatus === 'string' ? o.agentStatus : '',
    };
  }

  private toIsoOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
