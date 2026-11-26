import type { Request } from 'express';

/**
 * How the MCP tools handler asks "which tools did the assistant setting give
 * the person this call is made for" (CLEAN-254). Provided by the
 * assistantAccess slice (`AssistantToolPolicyService`), from the same grant
 * its tool policy narrows the list by; resolved with `strict: false` and a
 * try/catch, like the agent-manager resolver, so the mcp slice does not
 * depend on it.
 *
 * The answer is a set of tool names only when all of this holds: the call
 * carries the token of the installation's assistant, it is made for a
 * signed-in person a setting applies to, and that setting is switched on.
 * Otherwise it is `null`: another agent, a person's own console token, a
 * guest, the Owner, the assistant switched off for that person.
 *
 * A missing resolver, or one that throws, fails closed: nothing is granted.
 * The handler keeps the `manage-agent` names of the answer and nothing else,
 * so a grant never lifts a tool into the `admin` or `owner` audience.
 */
export const ASSISTANT_GRANT_RESOLVER = Symbol('ASSISTANT_GRANT_RESOLVER');

export interface IAssistantGrantResolver {
  grantedToolsFor(httpRequest: Request): Promise<ReadonlySet<string> | null>;
}
