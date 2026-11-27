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

/**
 * Who is offered Share on an agent (CLEAN-269). Whoever can open an agent
 * may share it (spec clarification, 2026-09-07), with one exception: the
 * public link of the Ranch assistant decides who reaches it from outside,
 * and is the Owner's alone (CLEAN-268). For anybody else the API answers
 * "Agent not found" on its share-link routes, so the button is not there to
 * ask them. The sheet's note already says who runs that agent.
 *
 * The management console needs no twin of this line: its Share sits in the
 * agent's menu, which is drawn for `canManageAgent` only.
 */
export function canShareAgent(
  viewerRole: string | null | undefined,
  agent: { isAdmin: boolean },
): boolean {
  return viewerRole === 'Owner' || !agent.isAdmin;
}

/**
 * Whether a pin is offered on an agent (CLEAN-269). A pin keeps an agent at
 * the top of the viewer's own lists; the Ranch assistant is the first row of
 * every list as it is (`railOrder`), for every role, the Owner included. So
 * there is no pin on it to set, and none is shown: the API answers
 * `pinned: false` for it, and the mapper reads it so from an older API too.
 *
 * Twin of `admin/slices/agent/agent/utils/agentAccess.ts`: the same line.
 */
export function canPinAgent(agent: { isAdmin: boolean }): boolean {
  return !agent.isAdmin;
}
