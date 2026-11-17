/**
 * Who may manage an agent, as the console sees it (CLEAN-232, contract
 * `acting-party.md` section 5). The API decides; this is the same rule read
 * off what the console already holds, so that it does not offer a control, or
 * send a request, the API would answer with "Agent not found".
 *
 * The Ranch admin agent (`isAdmin`) is the Owner's alone. Every other agent is
 * managed by anybody who can open this console, Owner or Admin, so the rule
 * has one line. It is the only place that line is written.
 */
export const OWNER_ROLE = 'Owner';

/** What a viewer who may not manage the agent reads in place of the controls. */
export const OWNER_MANAGED_TEXT = 'This agent is managed by the Owner.';

export function isOwnerRole(viewerRole: string | null | undefined): boolean {
  return viewerRole === OWNER_ROLE;
}

export function canManageAgent(
  viewerRole: string | null | undefined,
  agent: { isAdmin: boolean },
): boolean {
  return isOwnerRole(viewerRole) || !agent.isAdmin;
}
