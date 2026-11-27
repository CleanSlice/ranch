/**
 * What a pin means for one agent, in one place (CLEAN-269).
 *
 * A pin moves an agent to the top of one person's lists. The Ranch assistant
 * (`isAdmin`) is the first row of every list already, for everybody, whatever
 * they pinned: the rail of both consoles, the Orbit's ring, the agents page
 * (`railOrder`, `orbitLayout`). A pin on it changes nothing a person can see,
 * so it is not offered, not shown and not counted:
 *
 *  - every answer that carries `pinned` says false for the assistant
 *    (`isPinnedFor`), also for a person who pinned it before this rule. The
 *    row in `AgentPin` is left where it is: nothing reads it;
 *  - `pin_agent` answers one plain sentence and writes nothing
 *    (`assistantIsAlwaysFirst`). It is not a refusal and not an owner-only
 *    matter: the Owner is told the same.
 */
export function isPinnedFor(
  agent: { id: string; isAdmin: boolean },
  pinned: ReadonlySet<string>,
): boolean {
  return !agent.isAdmin && pinned.has(agent.id);
}

/** What somebody who asks to pin, or to unpin, the assistant is told. */
export function assistantIsAlwaysFirst(name: string): string {
  return (
    `${name.trim() || 'This agent'} is the Ranch assistant: it is always ` +
    'first in every agent list, so it is not pinned. Nothing was changed.'
  );
}
