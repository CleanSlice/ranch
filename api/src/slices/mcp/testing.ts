import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import { setCallerParty } from './tooling';

/**
 * For specs only: say who a fake tool request is made for (CLEAN-232).
 *
 * A tool spec builds its request by hand, `{ user: { sub: 'agent:…', roles } }`,
 * and the token alone no longer decides anything: an agent's request that
 * names no party is a guest's. So each spec states the party, the way the MCP
 * handler does for a real call, and reads as what it tests: "the Ranch admin
 * agent on its own schedule", "the same agent answering a User".
 *
 * Each helper marks the request it is given and returns it.
 */

/** The agent acting for itself: a scheduled job, an administrator it names. */
export function asTrustedAgent<T extends Request>(httpRequest: T): T {
  setCallerParty(httpRequest, { kind: 'trusted' });
  return httpRequest;
}

/** A signed-in console person, as an acting token would prove them. */
export function asPerson<T extends Request>(
  httpRequest: T,
  role: UserRoleTypes,
  userId = 'user-1',
): T {
  setCallerParty(httpRequest, { kind: 'person', userId, role });
  return httpRequest;
}

/** Nobody: a share visitor, a messenger user, a runtime that names no actor. */
export function asGuest<T extends Request>(httpRequest: T): T {
  setCallerParty(httpRequest, { kind: 'guest' });
  return httpRequest;
}
