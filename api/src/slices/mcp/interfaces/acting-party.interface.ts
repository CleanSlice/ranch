import type {
  IAuthTokenPayload,
  ICallerParty,
} from '#/user/auth/domain/auth.types';

/**
 * How the MCP tools handler asks "who is this call made for" (CLEAN-232).
 * Provided by the auth module (`ActingPartyService`); resolved with
 * `strict: false` and a try/catch, like the listing recorder, so the mcp
 * slice does not depend on the provider.
 *
 * A missing resolver fails closed: an agent's call is then a guest's. A
 * person's own console token still speaks for that person, because that is
 * read from the bearer itself (`callerParty` in `../tooling`).
 */
export const ACTING_PARTY_RESOLVER = Symbol('ACTING_PARTY_RESOLVER');

/** `_meta` key a runtime states the actor under, on tools/list and tools/call. */
export const ACTOR_META_KEY = 'ranch/actor';

/** `_meta` key each listed tool carries its audience under. */
export const AUDIENCE_META_KEY = 'ranch/audience';

export interface IActingPartyResolver {
  /**
   * `bearer` is the verified token of the HTTP request, `actor` is what the
   * call states in `_meta["ranch/actor"]`. Never throws; whatever does not
   * check out is `{ kind: 'guest' }`.
   */
  resolve(
    bearer: IAuthTokenPayload | null | undefined,
    actor: { kind?: unknown; token?: unknown } | null | undefined,
  ): Promise<ICallerParty>;
}
