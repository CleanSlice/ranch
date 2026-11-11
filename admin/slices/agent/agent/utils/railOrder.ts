// The order of the agent rail (CLEAN-136, CLEAN-216). Pure on purpose: no
// Vue, no Nuxt aliases, so `bun test` runs it.

/**
 * The Ranch admin agent first, then the pinned agents, then everything else
 * in the order it came in.
 *
 * Twin of the app console's rail (`app/slices/agent/utils/railOrder.ts`),
 * which applies the same rule for the same reasons: the admin agent is the
 * one that manages the rest, and in a list ordered newest-first the oldest
 * agent of the install sits last; a pin (CLEAN-216) is the person's own "I
 * reach for this one" and follows it. Inside each block the incoming order
 * stands, so two pinned agents keep their places between polls.
 */
export function railOrder<T extends { isAdmin: boolean; pinned?: boolean }>(
  agents: readonly T[],
): T[] {
  const admin: T[] = [];
  const pinned: T[] = [];
  const rest: T[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i] as T;
    if (agent.isAdmin) admin.push(agent);
    else if (agent.pinned) pinned.push(agent);
    else rest.push(agent);
  }
  return admin.concat(pinned, rest);
}
