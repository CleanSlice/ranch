// Whose agent this is, as this console shows it (CLEAN-259). Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.
//
// One place decides the mark on the avatar, the words in the header and the
// filter, so the rail and the open agent cannot tell two stories about one
// agent (docs/state.md, rule 6). "Created by" on Overview reads the same
// record through `agentCreatorView` (`utils/agentCreator.ts`).
//
// Twin of `app/slices/agent/utils/agentOwnership.ts`. The mark and the
// filter are the same there. What differs is who looks: this console is
// opened by an Owner or an Admin only, and the API tells both who created an
// agent, so nothing here asks for the viewer's role, and there is no note
// about an agent somebody else runs: they manage it anyway.

export interface IAgentCreatorLike {
  name: string | null;
  email: string | null;
}

export interface IOwnedAgentLike {
  /** The API's own answer: the viewer is the recorded creator. */
  createdByMe?: boolean;
  /** `null`: nobody is recorded. Name and email both `null`: the account
   *  has since been removed. */
  createdBy?: IAgentCreatorLike | null;
}

/** Up to two letters of a person's name: "Dmitriy Zhuk" and "d.zhuk" are DZ. */
export function creatorInitials(name: string): string {
  return (
    name
      .trim()
      .split(/[\s._@-]+/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('') || '?'
  );
}

/**
 * Who created the agent.
 *
 *  - `mine`: the viewer did.
 *  - `other`: somebody else, by name.
 *  - `removed`: an account that has since been removed.
 *  - `unknown`: nobody is recorded (the agent is older than the field).
 */
export type AgentCreatorTypes =
  | { kind: 'mine' }
  | { kind: 'other'; name: string; initials: string }
  | { kind: 'removed' }
  | { kind: 'unknown' };

export function agentCreator(agent: IOwnedAgentLike): AgentCreatorTypes {
  if (agent.createdByMe) return { kind: 'mine' };
  if (!agent.createdBy) return { kind: 'unknown' };
  const name = agent.createdBy.name?.trim() || agent.createdBy.email?.trim() || '';
  if (!name) return { kind: 'removed' };
  return { kind: 'other', name, initials: creatorInitials(name) };
}

/** What the header says beside the name, in words. */
export function creatorText(creator: AgentCreatorTypes): string {
  switch (creator.kind) {
    case 'mine':
      return 'Your agent';
    case 'other':
      return `by ${creator.name}`;
    case 'removed':
      return 'created by a removed account';
    default:
      return 'creator not recorded';
  }
}

/**
 * The badge on the avatar's corner: filled for the viewer's own, outlined
 * with the creator's initials for somebody else's. Nothing when there is
 * nobody to name: an unrecorded creator is said in words, in the header.
 */
export type OwnerMarkTypes =
  | { kind: 'mine' }
  | { kind: 'other'; name: string; initials: string };

export function ownerMark(agent: IOwnedAgentLike): OwnerMarkTypes | null {
  const creator = agentCreator(agent);
  return creator.kind === 'mine' || creator.kind === 'other' ? creator : null;
}

/** The words for the badge, for a reader who cannot see it. */
export function ownerMarkText(mark: OwnerMarkTypes): string {
  return mark.kind === 'mine' ? 'created by you' : `created by ${mark.name}`;
}

/* ── The filter ──────────────────────────────────────────────────────── */

export type OwnerFilterTypes = 'all' | 'mine';

export function ownAgents<T extends { createdByMe?: boolean }>(
  agents: readonly T[],
): T[] {
  return agents.filter((a) => a.createdByMe === true);
}

/**
 * The filter as it applies right now: "Mine" with nothing of one's own is
 * "All", so a list cannot be emptied by a filter that is no longer offered.
 */
export function effectiveOwnerFilter(
  wanted: OwnerFilterTypes,
  ownCount: number,
): OwnerFilterTypes {
  return wanted === 'mine' && ownCount > 0 ? 'mine' : 'all';
}

export function filterByOwner<T extends { createdByMe?: boolean }>(
  agents: readonly T[],
  filter: OwnerFilterTypes,
): T[] {
  return filter === 'mine' ? ownAgents(agents) : [...agents];
}
