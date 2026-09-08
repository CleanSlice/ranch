// The generated SDK class for the `/share` controller is also named
// `ShareService`; alias it to `ShareApi` so it doesn't collide with the
// domain `ShareService` (see `bridle.gateway.ts` for the same pattern).
import { ShareLinksService, ShareService as ShareApi } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import {
  IShareGateway,
  ShareResolveUnreadableError,
} from '../domain/share.gateway';
import type {
  IShareLinkState,
  IShareResolved,
} from '../domain/share.types';
import { ShareMapper } from './share.mapper';

/**
 * Share-link API gateway.
 *
 * `execute` → SDK call → `unwrapEnvelope` → mapper, the same shape every
 * other gateway in the app follows.
 *
 * Every call passes `throwOnError: true`. Without it the axios client hands a
 * non-2xx back as an ordinary result with `data: undefined`, which the mapper
 * would happily turn into the "never shared" state — so a 500 on Revoke would
 * read to the owner as "the link is off" while it is still live. With it, the
 * failure travels through `BaseGateway.execute` into `shareStore.error`, and
 * the panel says something went wrong instead of lying about the link.
 */
export class ShareGateway extends BaseGateway implements IShareGateway {
  private mapper = new ShareMapper();

  getLink(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.getAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  share(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.createAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  regenerate(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.regenerateAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  revoke(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.revokeAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  /**
   * Visitor side. The one method that has to tell *why* it failed: a 404 means
   * there is no such link (the page says so and stops), anything else means we
   * learned nothing and the page must keep whatever it already had.
   *
   * `null` is therefore reserved for "the API says this token is not a link";
   * every other failure — including a 200 the mapper cannot read — is thrown.
   */
  resolve(token: string): Promise<IShareResolved | null> {
    return this.execute(async () => {
      try {
        // `throwOnError` matters most here: without it a dropped connection
        // would map to the same `null` as a revoked link.
        const res = await ShareApi.resolveShareLink({
          body: { token },
          throwOnError: true,
        });
        const resolved = this.mapper.toResolved(unwrapEnvelope(res.data));
        // A 200 we cannot read is a broken answer, not a dead link. Returning
        // the mapper's `null` here would tell the page the token is invalid —
        // terminal, polling stopped — over what may be one malformed response.
        if (!resolved) throw new ShareResolveUnreadableError();
        return resolved;
      } catch (error) {
        // Unknown and revoked tokens answer with the same 404 (FR-013). The
        // throw above carries no response, so it falls through to the rethrow
        // and reaches the store as `unavailable`.
        if (statusOf(error) === 404) return null;
        throw error;
      }
    });
  }
}

/** HTTP status of a failed request; `0` when it never got an answer at all. */
function statusOf(error: unknown): number {
  const e = error as { response?: { status?: number } } | null | undefined;
  return e?.response?.status ?? 0;
}
