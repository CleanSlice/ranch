/**
 * Who gets the controls of an agent in this console (CLEAN-232, contract
 * `acting-party.md` section 5): restart, stop, start and the pin. The API
 * decides; this is the same rule read off what the console already holds, so
 * that it does not offer a control the API would answer with "Agent not
 * found".
 *
 * Twin of `admin/slices/agent/agent/utils/agentAccess.ts`. The line about the
 * Ranch admin agent (`isAdmin`) is the same there: it is the Owner's alone.
 * What differs is who else is here. The management console is opened by an
 * Owner or an Admin only; this one by a User too, who gets no controls on any
 * agent, as before.
 */
export function canManageAgent(
  viewerRole: string | null | undefined,
  agent: { isAdmin: boolean },
): boolean {
  if (viewerRole === 'Owner') return true;
  return viewerRole === 'Admin' && !agent.isAdmin;
}
