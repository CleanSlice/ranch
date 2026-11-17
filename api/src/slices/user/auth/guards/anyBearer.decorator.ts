import { UserRoleTypes } from '../../user/domain';
import { Roles } from './roles.decorator';

/** The roles `@AnyBearer()` states: a person of any role, or an agent. */
export const ANY_BEARER_ROLES: readonly UserRoleTypes[] = [
  UserRoleTypes.User,
  UserRoleTypes.Agent,
];

/**
 * Open to every authenticated bearer: a signed-in person of any role, or an
 * agent runtime with its own token. Still a role, so RolesGuard has something
 * to check and a token that holds none is refused.
 *
 * For the MCP endpoints and nothing else (app.module.ts). They are the one
 * place where the bearer does not decide what happens next: every tools/list
 * and tools/call is answered for the party the call is made for, by the
 * tool's audience (`#/mcp/tooling`). A REST route that used this would hand
 * its whole surface to every agent; agentRoutes.spec.ts and
 * userRoutes.spec.ts would both show it.
 */
export const AnyBearer = () => Roles(...ANY_BEARER_ROLES);
