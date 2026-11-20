import type {
  IAuthTokenPayload,
  ICallerParty,
} from '#/user/auth/domain/auth.types';

/**
 * How the MCP tools handler asks "is this call part of a question another
 * agent handed over" (CLEAN-236). Provided by the peer slice
 * (`PeerPartyResolver`, over `HandoverService`); resolved with `strict:
 * false` and a try/catch, like the acting-party resolver, so the mcp slice
 * does not depend on it.
 *
 * A missing resolver, or one that throws, fails closed: the call is a
 * guest's, which is what a peer's question is for power anyway. What is lost
 * without it is the chain, and with the chain every peer that is not open to
 * visitors.
 */
export const PEER_PARTY_RESOLVER = Symbol('PEER_PARTY_RESOLVER');

/** `_meta` key a runtime states the conversation a tool call belongs to under. */
export const TURN_META_KEY = 'ranch/turn';

export interface IPeerPartyResolver {
  /**
   * `bearer` is the verified token of the HTTP request, `token` what the
   * call states as its hand-over. Never throws; whatever does not check out
   * is `{ kind: 'guest' }`.
   */
  resolvePeer(
    bearer: IAuthTokenPayload | null | undefined,
    token: unknown,
  ): Promise<ICallerParty>;
}
