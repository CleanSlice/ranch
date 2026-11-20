import {
  SHARE_ATTACHMENT_KINDS,
  type IShareAttachments,
  type IShareLimits,
  type IShareLinkState,
  type IShareResolved,
  type IShareSkill,
  type ShareAttachmentKind,
} from '../domain/share.types';

/**
 * Maps the share-link API onto domain shapes.
 *
 * Both inputs are read defensively from `unknown` — the same treatment
 * `AgentMapper` gives the agents endpoints — rather than typed against the
 * generated `ShareLinkDto` / `ShareResolvedDto` directly, so a field rename on
 * the wire degrades instead of failing typecheck. `ShareLinkDto` also carries
 * `rotationCount`, deliberately left unmapped: the owner panel has no use for
 * a raw rotation count.
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
      description: this.toTextOrNull(o.description),
      skills: this.toSkills(o.skills),
      limits: this.toLimits(o.limits),
      attachments: this.toAttachments(o.attachments),
    };
  }

  // The summary below decorates a link that already resolved. Each part is
  // read on its own and falls back to "nothing to show": an API that does not
  // send it yet, or sends it wrong, must never cost the visitor the chat.

  private toSkills(raw: unknown): IShareSkill[] {
    if (!Array.isArray(raw)) return [];
    const skills: IShareSkill[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const title = this.toTextOrNull(o.title);
      if (!title) continue;
      skills.push({ title, description: this.toTextOrNull(o.description) });
    }
    return skills;
  }

  /** `null` unless at least one window carries a usable value. */
  private toLimits(raw: unknown): IShareLimits | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const limits: IShareLimits = {
      perMinute: this.toCountOrNull(o.perMinute),
      perHour: this.toCountOrNull(o.perHour),
      perDay: this.toCountOrNull(o.perDay),
    };
    const any =
      limits.perMinute !== null ||
      limits.perHour !== null ||
      limits.perDay !== null;
    return any ? limits : null;
  }

  /** All three numbers or nothing: half a rule would be a wrong rule. */
  private toAttachments(raw: unknown): IShareAttachments | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const maxPerMessage = this.toCountOrNull(o.maxPerMessage);
    const maxFileBytes = this.toCountOrNull(o.maxFileBytes);
    const maxMessageBytes = this.toCountOrNull(o.maxMessageBytes);
    if (
      maxPerMessage === null ||
      maxFileBytes === null ||
      maxMessageBytes === null
    ) {
      return null;
    }
    const known = SHARE_ATTACHMENT_KINDS as readonly unknown[];
    const kinds = Array.isArray(o.kinds)
      ? (o.kinds.filter((kind) =>
          known.includes(kind),
        ) as ShareAttachmentKind[])
      : [];
    return { maxPerMessage, maxFileBytes, maxMessageBytes, kinds };
  }

  private toTextOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  /** A positive whole number, or `null`. */
  private toCountOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : null;
  }

  private toIsoOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
