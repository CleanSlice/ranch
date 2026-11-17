import type { IAgentCreator } from '#agent/domain';

/**
 * "Created by" on an agent's Overview (CLEAN-232): one place decides what the
 * line says, so the three states read the same wherever they are shown.
 *
 *  - `known`: the account exists. Its name, and its email when there is one
 *    and it differs from the name.
 *  - `removed`: an account created the agent and has since been removed. The
 *    API keeps the id and sends no name or email.
 *  - `unknown`: nobody is recorded. The agent is older than the field, or the
 *    Ranch admin agent created it on its own.
 */
export type AgentCreatorView =
  | { state: 'known'; name: string; email: string | null }
  | { state: 'removed'; text: 'Removed account' }
  | { state: 'unknown'; text: 'Unknown' };

/**
 * The one field a full agent record may not carry. The status stream is
 * anonymous, so its frames never say who created an agent; a record decoded
 * from one has `createdBy: undefined`, and the creator the store already
 * holds stands. A record that does say (a creator, or `null` for nobody)
 * wins. What comes back always has a creator or `null`.
 */
export function keepKnownCreator<
  T extends { createdBy?: IAgentCreator | null },
>(incoming: T, previous: T | undefined): T {
  if (incoming.createdBy !== undefined) return incoming;
  return { ...incoming, createdBy: previous?.createdBy ?? null };
}

export function agentCreatorView(
  createdBy: IAgentCreator | null | undefined,
): AgentCreatorView {
  if (!createdBy) return { state: 'unknown', text: 'Unknown' };
  const name = createdBy.name?.trim() ?? '';
  const email = createdBy.email?.trim() ?? '';
  if (!name && !email) return { state: 'removed', text: 'Removed account' };
  if (!name) return { state: 'known', name: email, email: null };
  return { state: 'known', name, email: email && email !== name ? email : null };
}
