// The order of the agent rail (CLEAN-136). Pure on purpose: no Vue, no Nuxt
// aliases, so `bun test` runs it.

/**
 * The Ranch admin agent first, everything else in the order it came in.
 *
 * Twin of the admin console's rail (`useAgentRailEntries`), which pins the
 * same agent for the same reason: it is the one that manages the rest, and in
 * a list ordered newest-first the oldest agent of the install sits last.
 * Several flagged agents all come first, in their own order.
 */
export function railOrder<T extends { isAdmin: boolean }>(
  agents: readonly T[],
): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i] as T;
    if (agent.isAdmin) pinned.push(agent);
    else rest.push(agent);
  }
  return pinned.concat(rest);
}
