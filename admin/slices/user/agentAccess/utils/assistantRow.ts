// The assistant among the agents of an account's access lists (CLEAN-240):
// it is not one of them. Pure on purpose, so the rule has a test.

interface IListed {
  name: string;
  isAdmin?: boolean;
}

/** The agents the lists are about: every agent but the assistant. */
export function listedAgents<T extends IListed>(agents: readonly T[]): T[] {
  return agents.filter((agent) => agent.isAdmin !== true);
}

/**
 * Whether what was typed finds the assistant and nothing else. Then the list
 * says where it is set, instead of "no agent matches".
 */
export function searchNamesAssistant(
  agents: readonly IListed[],
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return false;
  const matches = agents.filter((agent) =>
    agent.name.toLowerCase().includes(needle),
  );
  return matches.length > 0 && matches.every((agent) => agent.isAdmin === true);
}
