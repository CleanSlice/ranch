import { SetMetadata } from '@nestjs/common';

export const AGENT_SCOPED_METADATA_KEY = 'agentScoped';

/**
 * Where a route names its agent:
 *
 *  - `'id'`, `'agentId'`: a route parameter. It is always there; a route
 *    without it answers "not found".
 *  - `'query.agentId'`, `'body.agentId'`: an optional filter or a field of
 *    the body. When it is absent the route names no agent and the guard
 *    lets it through; a route that lists across agents then filters its
 *    result itself (`AgentAccessService.reachableIds`).
 */
export type AgentScopeSources =
  | 'id'
  | 'agentId'
  | 'query.agentId'
  | 'body.agentId';

export interface IAgentScope {
  source: AgentScopeSources;
  /**
   * The route's own "not found" for an agent that does not exist, so that an
   * agent the caller does not reach is answered with the very same words.
   * A function gets the id the request named.
   */
  notFound?: string | ((agentId: string) => string);
}

/**
 * Marks a route, or a whole controller, as naming ONE agent the caller must
 * reach (CLEAN-231). `AgentAccessGuard` reads it and answers 404, exactly as
 * for an agent that does not exist, to a person whose lists hide the agent.
 *
 * It says *which agents*; the role on the route says what kind of account.
 * A route that manages an agent carries `@ManagesAgent` instead: that rule
 * already includes reach. agentScopedRoutes.spec.ts fails when a route names
 * an agent and carries neither, and is not on its exemption list.
 */
export const AgentScoped = (
  source: AgentScopeSources,
  options: Pick<IAgentScope, 'notFound'> = {},
) => SetMetadata(AGENT_SCOPED_METADATA_KEY, { source, ...options });
