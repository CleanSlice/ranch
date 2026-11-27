import type { ICallerParty } from '#/user/auth/domain/auth.types';
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

  /**
   * The Ranch assistant, for a caller who reaches it and may not manage it
   * because it is the Owner's alone; null for everybody else (CLEAN-263).
   * The handler asks on every tools/call and notes the answer, so that a
   * refusal for that one agent says whose it is and not "not found": who
   * manages it, for a `manage-agent` tool, and who reads its conversations,
   * for a chat tool (CLEAN-267). Missing, or throwing, leaves nothing noted
   * and the refusal at not-found: this fails towards saying less.
   */
  ownerOnlyAgentFor?(
    caller: ICallerParty,
  ): Promise<{ id: string; name: string } | null>;
}
