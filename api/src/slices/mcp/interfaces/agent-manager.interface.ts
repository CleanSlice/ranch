import type { UserRoleTypes } from '#/user/user/domain';

/**
 * How the MCP tools handler asks "does this person manage any agent"
 * (CLEAN-232), which is what lists the `manage-agent` tools for somebody
 * below Admin: a person who created an agent. Provided by the agent slice
 * (`AgentPermissionService`); resolved with `strict: false` and a try/catch,
 * like the acting-party resolver, so the mcp slice does not depend on it.
 *
 * A missing resolver, or one that throws, fails closed: the person is then
 * shown no `manage-agent` tool. Owner, Admin and a trusted party never need
 * the answer, so the handler does not ask for them.
 */
export const AGENT_MANAGER_RESOLVER = Symbol('AGENT_MANAGER_RESOLVER');

export interface IAgentManagerResolver {
  managesAny(person: { userId: string; role: UserRoleTypes }): Promise<boolean>;
}
