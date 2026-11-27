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

// ── What Ranch keeps about its assistant (CLEAN-269) ────────────
//
// Having the assistant means talking to it. Its conversations with other
// people, its usage figures and its evaluations are the Owner's to read
// (CLEAN-236, CLEAN-268): for anybody else the API leaves them out of every
// list and every total, and answers "not found" by id. A page that shows
// such a list says so in one line, so that a shorter list or a smaller total
// is read as an access limit and not as a fault or as nothing being there.
// The sentence is the one the assistant's tools give (`ownerOnlyLeftOut` in
// the API), and the app console's statistics say the same through i18n.

/**
 * The Ranch assistant among `agents`, when its records are NOT this viewer's
 * to read: null for the Owner, and null when the viewer does not have the
 * assistant at all (it is not in the agents the API returned, and no page
 * names it to them).
 */
export function ownerOnlyAssistant<T extends { isAdmin: boolean }>(
  viewerRole: string | null | undefined,
  agents: readonly T[],
): T | null {
  if (isOwnerRole(viewerRole)) return null;
  return agents.find((agent) => agent.isAdmin) ?? null;
}

/**
 * "The usage figures of Rancher, the Ranch assistant, are not included: only
 * the Owner can read them." `what` is the plural noun, as the page calls it.
 */
export function ownerOnlyLeftOutText(what: string, name: string): string {
  const whose = name.trim()
    ? `${name.trim()}, the Ranch assistant,`
    : 'the Ranch assistant';
  return `The ${what} of ${whose} are not included: only the Owner can read them.`;
}

/**
 * What a page says in place of a record the API answered "not found" for.
 * One sentence for an id that names nothing and for a record of an agent the
 * viewer may not read: which of the two it was is not theirs to learn.
 */
export function notAvailableText(viewerRole: string | null | undefined): string {
  return isOwnerRole(viewerRole)
    ? 'It does not exist, or it was removed.'
    : 'It does not exist, or it is not yours to read.';
}

// ── What the assistant is built from (CLEAN-271) ────────────────
//
// The assistant is the Owner's alone, and so is everything its pod is put
// together from at the next restart: its template and that template's
// files, the skills and tool servers the template attaches, the model
// credential and the knowledge bases its row names. The API marks each such
// resource `assistantDependency` on its lists and details, and refuses
// anybody else's write with 403 `ASSISTANT_BUILT_FROM`. A page shows such a
// resource read-only, with one line, and offers no control that would be
// refused.

/**
 * Whether `resource` is one this viewer may look at and not change: one the
 * assistant is built from, for anybody but the Owner.
 */
export function ownerOnlyIngredient(
  viewerRole: string | null | undefined,
  resource: { assistantDependency?: boolean } | null | undefined,
): boolean {
  return !isOwnerRole(viewerRole) && resource?.assistantDependency === true;
}

/**
 * "Part of what Rancher, the Ranch assistant, is built from: only the Owner
 * can change it." `name` is the assistant's, empty for a viewer who does not
 * have it.
 */
export function builtFromText(name: string): string {
  const whose = name.trim()
    ? `${name.trim()}, the Ranch assistant,`
    : 'the Ranch assistant';
  return `Part of what ${whose} is built from: only the Owner can change it.`;
}

// ── The settings the assistant is deployed from (CLEAN-271) ─────
//
// The assistant runs on the settings the Owner approved. A setting somebody
// else changes takes effect for every other agent and is kept back from the
// assistant until the Owner applies it. The API decides; the console says
// so where the change is made, and shows the Owner what is kept back.

/**
 * The setting groups the assistant is served the approved values of: the
 * same list as `APPROVED_SETTING_GROUPS` in the API
 * (`api/src/slices/agent/assistantBuild/domain/assistantSetting.service.ts`).
 */
export const APPROVED_SETTING_GROUPS: readonly string[] = [
  'integrations',
  'infrastructure',
  'knowledge',
  'agent_defaults',
  'a2a',
];

/** What an Admin reads under a form that edits one of those settings. */
export const APPROVED_SETTINGS_TEXT =
  'The Ranch assistant keeps the values the Owner approved; this change applies to other agents.';

/**
 * Whether that line belongs under a form: it edits a setting of one of
 * those groups, and the viewer is not the Owner (whose change is the
 * approval).
 */
export function keptFromAssistant(
  viewerRole: string | null | undefined,
  groups: readonly string[],
): boolean {
  return (
    !isOwnerRole(viewerRole) &&
    groups.some((group) => APPROVED_SETTING_GROUPS.includes(group))
  );
}

/** "integrations.s3_bucket — changed by Ada Admin" for the Owner's notice. */
export function settingDriftLine(drift: {
  group: string;
  name: string;
  change: string;
  changedByName: string | null;
}): string {
  const what =
    drift.change === 'added'
      ? 'added'
      : drift.change === 'removed'
        ? 'removed'
        : 'changed';
  return `${drift.group}.${drift.name}: ${what}${
    drift.changedByName ? ` by ${drift.changedByName}` : ''
  }`;
}

/**
 * Whether a pin is offered on an agent (CLEAN-269). A pin keeps an agent at
 * the top of the viewer's own lists; the Ranch assistant is the first row of
 * every list as it is (`railOrder`), for every role, the Owner included. So
 * there is no pin on it to set, and none is shown: the API answers
 * `pinned: false` for it, and the mapper reads it so from an older API too.
 *
 * Twin of `app/slices/agent/utils/agentAccess.ts`: the same line.
 */
export function canPinAgent(agent: { isAdmin: boolean }): boolean {
  return !agent.isAdmin;
}
