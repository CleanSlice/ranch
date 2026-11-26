// Whose agent this is, as this console shows it (CLEAN-259). Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.
//
// One place decides the mark on the avatar, the words beside "Created" and
// the note under the sheet, so the rail, the map and the header cannot tell
// three stories about one agent (docs/state.md, rule 6).
//
// Twin of `admin/slices/agent/agent/utils/agentOwnership.ts`. The mark and
// the filter are the same there. What differs is who looks: the management
// console is opened by an Owner or an Admin only, so it has no note for an
// agent somebody else runs.

export interface IAgentCreatorLike {
  name: string | null;
  email: string | null;
}

export interface IOwnedAgentLike {
  isAdmin: boolean;
  /** The API's own answer: the viewer is the recorded creator. */
  createdByMe: boolean;
  /** Resolved for an Owner or Admin only; null for everybody else. */
  createdBy: IAgentCreatorLike | null;
}

/** Owner and Admin: the roles the API tells who created an agent. */
export function isOperatorRole(role: string | null | undefined): boolean {
  return role === 'Owner' || role === 'Admin';
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
 * Who created the agent, as far as this viewer is told.
 *
 *  - `mine`: the viewer did.
 *  - `other`: somebody else, by name. Operators only.
 *  - `removed`: an account that has since been removed. Operators only.
 *  - `unknown`: nobody is recorded (the agent is older than the field).
 *    Operators only.
 *  - `null`: nothing to say. Every agent a User did not create.
 */
export type AgentCreatorTypes =
  | { kind: 'mine' }
  | { kind: 'other'; name: string; initials: string }
  | { kind: 'removed' }
  | { kind: 'unknown' };

export function agentCreator(
  agent: IOwnedAgentLike,
  viewerRole: string | null | undefined,
): AgentCreatorTypes | null {
  if (agent.createdByMe) return { kind: 'mine' };
  if (!isOperatorRole(viewerRole)) return null;
  if (!agent.createdBy) return { kind: 'unknown' };
  const name = agent.createdBy.name?.trim() || agent.createdBy.email?.trim() || '';
  if (!name) return { kind: 'removed' };
  return { kind: 'other', name, initials: creatorInitials(name) };
}

/**
 * The badge on the avatar's corner: filled for the viewer's own, outlined
 * with the creator's initials for somebody else's. Nothing when there is
 * nobody to name: an unrecorded creator is said in words, in the header.
 */
export type OwnerMarkTypes =
  | { kind: 'mine' }
  | { kind: 'other'; name: string; initials: string };

export function ownerMark(
  agent: IOwnedAgentLike,
  viewerRole: string | null | undefined,
): OwnerMarkTypes | null {
  const creator = agentCreator(agent, viewerRole);
  return creator?.kind === 'mine' || creator?.kind === 'other' ? creator : null;
}

/* ── The filter ──────────────────────────────────────────────────────── */

export type OwnerFilterTypes = 'all' | 'mine';

export function ownAgents<T extends { createdByMe: boolean }>(
  agents: readonly T[],
): T[] {
  return agents.filter((a) => a.createdByMe);
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

export function filterByOwner<T extends { createdByMe: boolean }>(
  agents: readonly T[],
  filter: OwnerFilterTypes,
): T[] {
  return filter === 'mine' ? ownAgents(agents) : [...agents];
}

/* ── The note ────────────────────────────────────────────────────────── */

/**
 * The one note under an agent's sheet, or none.
 *
 *  - `mine`: the viewer created it, so they manage it. `byRoleToo` is false
 *    for a User, whose role manages no other agent: the note says so.
 *  - `assistant`: somebody else runs it, and the assistant setting lets the
 *    viewer do the named things to it.
 *  - `available`: somebody else runs it; the viewer talks to it and shares it.
 *
 * None on the Ranch admin agent (the console says what it is elsewhere) and
 * none for an Owner or Admin on an agent they did not create: they manage
 * it anyway, and nothing needs explaining.
 */
export type OwnershipNoteTypes =
  | { kind: 'mine'; byRoleToo: boolean }
  | { kind: 'assistant'; abilities: string[] }
  | { kind: 'available' };

export function ownershipNote(
  agent: IOwnedAgentLike,
  viewerRole: string | null | undefined,
  /** Titles of what the assistant may do to an agent for the viewer. */
  assistantAbilities: readonly string[] = [],
): OwnershipNoteTypes | null {
  if (agent.isAdmin) return null;
  const operator = isOperatorRole(viewerRole);
  if (agent.createdByMe) return { kind: 'mine', byRoleToo: operator };
  if (operator) return null;
  return assistantAbilities.length
    ? { kind: 'assistant', abilities: [...assistantAbilities] }
    : { kind: 'available' };
}
