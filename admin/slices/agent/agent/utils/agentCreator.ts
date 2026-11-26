import type { IAgentCreator } from '#agent/domain';

/**
 * "Created by" on an agent's Overview (CLEAN-232): one place decides what the
 * line says, so the three states read the same wherever they are shown.
 *
 *  - `known`: the account exists. Its name, and its email when there is one
 *    and it differs from the name. `you` when it is the viewer's own account
 *    (CLEAN-259): the line then starts with "You", as the header says "Your
 *    agent".
 *  - `removed`: an account created the agent and has since been removed. The
 *    API keeps the id and sends no name or email.
 *  - `unknown`: nobody is recorded. The agent is older than the field, or the
 *    Ranch admin agent created it on its own.
 */
export type AgentCreatorView =
  | { state: 'known'; you: boolean; name: string; email: string | null }
  | { state: 'removed'; text: 'Removed account' }
  | { state: 'unknown'; text: 'Creator not recorded' };

/**
 * The two fields a full agent record may not carry. The status stream is
 * anonymous, so its frames never say who created an agent, nor whether the
 * viewer did (CLEAN-259); a record decoded from one has `createdBy` and
 * `createdByMe` `undefined`, and what the store already holds stands. A
 * record that does say (a creator, or `null` for nobody; yes or no) wins,
 * field by field: `GET /agents/status` says whether it is the viewer's and
 * not who made it. What comes back always has a creator or `null`, and a
 * yes or a no.
 */
export function keepKnownCreator<
  T extends { createdBy?: IAgentCreator | null; createdByMe?: boolean },
>(incoming: T, previous: T | undefined): T {
  if (incoming.createdBy !== undefined && incoming.createdByMe !== undefined) {
    return incoming;
  }
  return {
    ...incoming,
    createdBy:
      incoming.createdBy !== undefined
        ? incoming.createdBy
        : (previous?.createdBy ?? null),
    createdByMe:
      incoming.createdByMe !== undefined
        ? incoming.createdByMe
        : (previous?.createdByMe ?? false),
  };
}

export function agentCreatorView(
  createdBy: IAgentCreator | null | undefined,
  /** The viewer is that account (the record's `createdByMe`). */
  createdByMe: boolean = false,
): AgentCreatorView {
  // The viewer's own agent is theirs even if the name did not come along.
  if (!createdBy && createdByMe) {
    return { state: 'known', you: true, name: '', email: null };
  }
  if (!createdBy) return { state: 'unknown', text: 'Creator not recorded' };
  const name = createdBy.name?.trim() ?? '';
  const email = createdBy.email?.trim() ?? '';
  if (!name && !email) {
    return createdByMe
      ? { state: 'known', you: true, name: '', email: null }
      : { state: 'removed', text: 'Removed account' };
  }
  if (!name) return { state: 'known', you: createdByMe, name: email, email: null };
  return {
    state: 'known',
    you: createdByMe,
    name,
    email: email && email !== name ? email : null,
  };
}
