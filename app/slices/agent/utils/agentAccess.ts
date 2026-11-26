/**
 * Who gets the controls of an agent in this console (CLEAN-232, contract
 * `acting-party.md` section 5): restart, stop and start. The API decides;
 * this is the same rule read off what the console already holds, so that it
 * does not offer a control the API would answer with "Agent not found". The
 * pin is not one of them: it is the viewer's own and open to every role
 * (CLEAN-231).
 *
 * Twin of `admin/slices/agent/agent/utils/agentAccess.ts`. The line about the
 * Ranch admin agent (`isAdmin`) is the same there: it is the Owner's alone.
 * What differs is who else is here. The management console is opened by an
 * Owner or an Admin only; this one by a User too, who gets the controls of
 * the agents they created and of no other (CLEAN-259: the API's third line,
 * "the caller created the agent", read off `createdByMe`, which is the
 * API's own answer).
 */
export function canManageAgent(
  viewerRole: string | null | undefined,
  agent: { isAdmin: boolean; createdByMe?: boolean },
): boolean {
  if (viewerRole === 'Owner') return true;
  if (agent.isAdmin) return false;
  if (viewerRole === 'Admin') return true;
  // Somebody signed in, of whatever role below Admin.
  return Boolean(viewerRole) && agent.createdByMe === true;
}
