import type { IShareLinkState } from '../domain/share.types';

/**
 * Maps the share-link API onto the domain shape.
 *
 * Read defensively from `unknown`, the same treatment the app's `ShareMapper`
 * gives this endpoint, so a field rename on the wire degrades instead of
 * failing typecheck.
 *
 * `url` is left `null` here: it depends on where the app console lives, which
 * is runtime config, not something the data layer should reach for. The store
 * fills it in.
 */
export class ShareMapper {
  /**
   * Never `null`: "no link row yet" and "unreadable response" are both just
   * *not shared*, which is exactly what the panel renders.
   */
  toState(raw: unknown): IShareLinkState {
    const o =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const token =
      typeof o.token === 'string' && o.token.length > 0 ? o.token : null;
    // A link with no token is unusable even if the API called it active, so it
    // reads as not shared rather than as a link the operator cannot copy.
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

  private toIsoOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
