// What the profile's right column shows, read from the address
// `/profile?tab=&period=&scope=` (CLEAN-258). It lives in the address so that
// a reload and the browser's Back work and a view can be sent as a link.
// The table is in specs/038-profile-stats-dashboard/contracts/ui.md.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export const TABS = ['stats', 'account'] as const;
export const PERIODS = [7, 30, 90] as const;
export const SCOPES = ['mine', 'installation'] as const;

export type StatsTab = (typeof TABS)[number];
/** Days: the three windows the API computes. */
export type StatsPeriod = (typeof PERIODS)[number];
export type StatsScope = (typeof SCOPES)[number];

export interface IStatsView {
  tab: StatsTab;
  period: StatsPeriod;
  scope: StatsScope;
}

export interface IStatsLocation {
  path: string;
  query: Record<string, string>;
}

export const DEFAULT_TAB: StatsTab = 'stats';
export const DEFAULT_PERIOD: StatsPeriod = 30;
export const DEFAULT_SCOPE: StatsScope = 'mine';

export const DEFAULT_STATS_VIEW: Readonly<IStatsView> = Object.freeze({
  tab: DEFAULT_TAB,
  period: DEFAULT_PERIOD,
  scope: DEFAULT_SCOPE,
});

const PATH = '/profile';

/** The parameters this module owns. Any other is somebody else's. */
const OWN = ['tab', 'period', 'scope'] as const;

/** A query value as one string: the first of a repeated parameter, or none. */
function single(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : null;
}

/**
 * Whether a role may look at the whole installation: the Owner and an Admin,
 * the same two `hasRole(Owner, Admin)` lets into the operator pages. The role
 * arrives as the string the server sent and is matched whatever its letter
 * case, as `capabilitiesFor` does. A role this console does not know sees its
 * own figures only.
 */
export function canSeeInstallation(role: string | null | undefined): boolean {
  const r = (role ?? '').toLowerCase();
  return r === 'owner' || r === 'admin';
}

/**
 * Anything the address does not spell out, or spells wrongly, is the default.
 *
 * `scope=installation` is read as `mine` for a role that may not see it: the
 * API would refuse anyway, and a link passed from an operator to a User should
 * open that User's own figures, not an error.
 *
 * The account tab has no period and no scope, so both read as defaults there
 * whatever the address says. That keeps one view to one address: two views are
 * equal exactly when `statsLocation` writes them the same.
 */
export function parseStatsView(
  query: Record<string, unknown>,
  role: string | null | undefined,
): IStatsView {
  const tab = TABS.find((t) => t === single(query.tab)) ?? DEFAULT_TAB;
  if (tab === 'account') return { ...DEFAULT_STATS_VIEW, tab };

  // Matched as text, so `07`, `7d` and `7.0` are unknown values, not sevens.
  const period = PERIODS.find((p) => String(p) === single(query.period)) ?? DEFAULT_PERIOD;
  const asked = SCOPES.find((s) => s === single(query.scope)) ?? DEFAULT_SCOPE;
  const scope = asked === 'installation' && !canSeeInstallation(role) ? DEFAULT_SCOPE : asked;

  return { tab, period, scope };
}

/**
 * The address of a view. A default is left out, so the plain `/profile` is the
 * statistics of 30 days; the account tab carries the tab alone.
 */
export function statsLocation(view: IStatsView): IStatsLocation {
  const query: Record<string, string> = {};
  if (view.tab === 'account') {
    query.tab = view.tab;
    return { path: PATH, query };
  }
  if (view.period !== DEFAULT_PERIOD) query.period = String(view.period);
  if (view.scope !== DEFAULT_SCOPE) query.scope = view.scope;
  return { path: PATH, query };
}

/**
 * Whether the address says something other than what `statsLocation(view)`
 * would write: an unknown value, a scope the role may not have, a default
 * spelled out, a repeated or empty parameter. The page then rewrites the
 * address with `replace`, so the correction does not become a step for Back.
 *
 * Only the three parameters of this module are compared; one that belongs to
 * somebody else is nothing to correct.
 */
export function isCorrection(query: Record<string, unknown>, view: IStatsView): boolean {
  const wanted = statsLocation(view).query;
  return OWN.some((key) => {
    const written = query[key];
    const expected = wanted[key];
    // Absent on both sides. `null` is `?tab` with no value: present, and noise.
    if (written === undefined) return expected !== undefined;
    return written !== expected;
  });
}
