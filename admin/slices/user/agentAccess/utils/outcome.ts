// What the access editor works out by itself (CLEAN-231, spec 032): the
// sentence that says what an account's lists come to, what a pending change
// would make of them, and who may edit whom. Pure on purpose: no Vue, no
// store, no request. The server decides; this only words and predicts.

export type AccessChoice = 'none' | 'allowed' | 'denied';
export type AccessOutcomeKind = 'all' | 'all_except' | 'only' | 'none';

export const ACCESS_CHOICES: readonly AccessChoice[] = [
  'none',
  'allowed',
  'denied',
];

export const ACCESS_CHOICE_LABELS: Record<AccessChoice, string> = {
  none: 'Default',
  allowed: 'Allowed',
  denied: 'Denied',
};

export interface IAccessOutcome {
  kind: AccessOutcomeKind;
  /** Denied for `all_except`, allowed for `only`, 0 otherwise. */
  count: number;
}

export interface IAccessLists {
  allowed: readonly string[];
  denied: readonly string[];
}

/** What the server said about the account, as far as a prediction needs it. */
export interface IAccessStored extends IAccessLists {
  outcome: IAccessOutcome;
  hasEntriesOutsideView: boolean;
}

export const REVIEW_TEXT =
  'The last allowed agent was deleted. This account reaches no agents until you choose.';
export const OUTSIDE_VIEW_TEXT = 'This account also has access you cannot manage.';
export const CONFIRM_OPEN_TEXT =
  'This account will reach every agent that is not denied.';

/** The four sentences of data-model.md, with the count the viewer may see. */
export function outcomeSentence(outcome: IAccessOutcome): string {
  switch (outcome.kind) {
    case 'all':
      return 'Reaches every agent';
    case 'all_except':
      // An Admin looking at an account whose denied agents are all outside
      // the Admin's view: open, as far as the Admin can see.
      return outcome.count > 0
        ? `Reaches every agent except ${outcome.count}`
        : 'Reaches every agent you can see';
    case 'only':
      // An Admin looking at an account whose allowed agents are all outside
      // the Admin's view: limited, and none of it is the Admin's to count.
      return outcome.count > 0
        ? `Reaches only these ${outcome.count}`
        : 'Reaches only agents you cannot manage';
    case 'none':
      return 'Reaches no agents — needs review';
  }
}

/** The one choice a row shows: an agent is on one list or on neither. */
export function choiceOf(agentId: string, lists: IAccessLists): AccessChoice {
  if (lists.denied.includes(agentId)) return 'denied';
  if (lists.allowed.includes(agentId)) return 'allowed';
  return 'none';
}

/**
 * The whole desired state inside the viewer's view: the stored lists with
 * the person's pending choices laid over them. A row has one choice, so an
 * agent cannot end on both lists.
 */
export function applyChoices(
  stored: IAccessLists,
  pending: Readonly<Record<string, AccessChoice>>,
): { allowed: string[]; denied: string[] } {
  const touched = new Set(Object.keys(pending));
  const allowed = stored.allowed.filter(
    (id) => !touched.has(id) && !stored.denied.includes(id),
  );
  const denied = stored.denied.filter((id) => !touched.has(id));
  for (const id of touched) {
    if (pending[id] === 'allowed') allowed.push(id);
    else if (pending[id] === 'denied') denied.push(id);
  }
  return { allowed: [...new Set(allowed)], denied: [...new Set(denied)] };
}

/** The agents whose pending choice differs from what is stored. */
export function changedAgents(
  stored: IAccessLists,
  pending: Readonly<Record<string, AccessChoice>>,
): string[] {
  return Object.keys(pending).filter(
    (id) => pending[id] !== choiceOf(id, stored),
  );
}

export interface IAccessPrediction {
  outcome: IAccessOutcome;
  /** The change turns a limited account into an open one. */
  opens: boolean;
  /**
   * False when the editor cannot tell: an Admin emptying the allowed agents
   * they can see of an account that may hold more outside their view. The
   * server says which it is.
   */
  certain: boolean;
}

/**
 * What saving `desired` would make of the account, by the server's rule: it
 * is limited while it has an allowed agent, and only then.
 */
export function predictOutcome(
  stored: IAccessStored,
  desired: IAccessLists,
): IAccessPrediction {
  const allowed = desired.allowed.length;
  const denied = desired.denied.length;
  if (allowed > 0) {
    return { outcome: { kind: 'only', count: allowed }, opens: false, certain: true };
  }
  const wasLimited =
    stored.outcome.kind === 'only' || stored.outcome.kind === 'none';
  // Limited with no allowed agent in view: the allowed agents are all
  // outside it, the server carries them over, and the account stays limited.
  if (stored.outcome.kind === 'only' && stored.allowed.length === 0) {
    return { outcome: { kind: 'only', count: 0 }, opens: false, certain: true };
  }
  // Open with no denied agent in view: the denials are all outside it and
  // are carried over, so the account stays "all except".
  const hiddenDenials =
    stored.outcome.kind === 'all_except' && stored.denied.length === 0;
  const open: IAccessOutcome =
    denied > 0 || hiddenDenials
      ? { kind: 'all_except', count: denied }
      : { kind: 'all', count: 0 };
  if (!wasLimited) return { outcome: open, opens: false, certain: true };
  return {
    outcome: open,
    opens: true,
    certain: !(stored.outcome.kind === 'only' && stored.hasEntriesOutsideView),
  };
}

export type AccessManagement = 'editable' | 'owner' | 'self' | 'other_admin' | 'none';

interface IAccount {
  id: string;
  role: string;
}

/**
 * Who may edit whom, as the API decides it (ACCESS_NOT_EDITABLE): nobody
 * edits the Owner or themselves, the Owner edits Admins and Users, an Admin
 * edits Users. Known before any request, so none is sent that would be
 * refused.
 */
export function accessManagement(
  viewer: IAccount | null | undefined,
  target: IAccount,
): AccessManagement {
  if (target.role === 'Owner') return 'owner';
  if (!viewer) return 'none';
  if (viewer.id === target.id) return 'self';
  if (viewer.role === 'Owner') return 'editable';
  if (viewer.role !== 'Admin') return 'none';
  if (target.role === 'Admin') return 'other_admin';
  return target.role === 'User' ? 'editable' : 'none';
}

/** The one line shown in place of the editor: who manages this access. */
export function managedByLine(management: AccessManagement): string {
  switch (management) {
    case 'owner':
      return 'The Owner reaches every agent. There is no agent access to manage on this account.';
    case 'self':
      return 'Your own agent access is managed by the Owner.';
    case 'other_admin':
      return "An Admin's agent access is managed by the Owner.";
    default:
      return 'Agent access for this account is managed by an administrator.';
  }
}

/** Rows whose agent name contains the query; all of them for an empty one. */
export function filterByName<T extends { name: string }>(
  agents: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...agents];
  return agents.filter((a) => a.name.toLowerCase().includes(q));
}

/** The marks on the user list: "Restricted" unless `all`, "Needs review". */
export function accessBadges(
  summary: { kind: AccessOutcomeKind; needsReview: boolean } | null | undefined,
): { restricted: boolean; needsReview: boolean } {
  if (!summary) return { restricted: false, needsReview: false };
  return { restricted: summary.kind !== 'all', needsReview: summary.needsReview };
}
