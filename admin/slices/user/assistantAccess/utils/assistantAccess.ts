import {
  ASSISTANT_LEVELS,
  type AssistantLevel,
  type AssistantLevelOrCustom,
  type IAbility,
  type IAbilityArea,
  type IAssistantCatalog,
  type PersonRole,
} from '../domain/assistantAccess.types';

// What the assistant's cards work out in the browser (CLEAN-240). The API
// decides what a person gets; this is for showing a choice before it is
// saved: counts, the three-state area switch, what a change would cost.
// Pure on purpose: no Pinia, no Nuxt.

const RANK: Record<PersonRole, number> = { User: 0, Admin: 1, Owner: 2 };

/** The role's console cannot do this, so no setting can offer it. */
export function isAbove(ability: IAbility, role: PersonRole): boolean {
  return RANK[ability.minRole] > RANK[role];
}

/**
 * Ticking it for this role gives it on agents the person created and on no
 * other (CLEAN-257): the tool refuses anybody below Admin who did not make
 * the agent. Still theirs to have, so it is tickable and counted; the panel
 * says so beside it, where "ticked" would otherwise read as "on every agent".
 */
export function isOwnAgentsOnly(ability: IAbility, role: PersonRole): boolean {
  return role === 'User' && ability.ownAgentsOnly && !isAbove(ability, role);
}

/** The words for that, as the Owner reads them about somebody else. */
export const OWN_AGENTS_ONLY_LABEL = 'Only on agents they created';

const abilitiesOf = (catalog: IAssistantCatalog): IAbility[] =>
  catalog.areas.flatMap((area) => area.abilities);

/** Everything a role can have at all, in the catalogue's order. */
export function ceilingNames(
  catalog: IAssistantCatalog,
  role: PersonRole,
): string[] {
  return abilitiesOf(catalog)
    .filter((a) => !isAbove(a, role))
    .map((a) => a.name);
}

/** The names a level gives a role. */
export function applyLevel(
  catalog: IAssistantCatalog,
  role: PersonRole,
  level: AssistantLevel,
): Set<string> {
  return new Set(
    abilitiesOf(catalog)
      .filter((a) => !isAbove(a, role) && a.levels.includes(level))
      .map((a) => a.name),
  );
}

/** A choice as the names it comes to for a role. */
export function offeredNames(
  catalog: IAssistantCatalog,
  role: PersonRole,
  choice: { level: AssistantLevelOrCustom; on?: readonly string[] | null },
): Set<string> {
  if (choice.level !== 'custom') return applyLevel(catalog, role, choice.level);
  const picked = new Set(choice.on ?? []);
  return new Set(ceilingNames(catalog, role).filter((name) => picked.has(name)));
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** The level a pick equals for this role, or null when it is its own. */
export function matchingLevel(
  catalog: IAssistantCatalog,
  role: PersonRole,
  on: ReadonlySet<string>,
): AssistantLevel | null {
  return (
    ASSISTANT_LEVELS.find((level) => sameSet(on, applyLevel(catalog, role, level))) ??
    null
  );
}

/**
 * The levels worth offering a role: one that gives the same as the level
 * below it is left out. For a User that is Full — everything beyond Standard
 * is above the role.
 */
export function levelsFor(
  catalog: IAssistantCatalog,
  role: PersonRole,
): AssistantLevel[] {
  const kept: AssistantLevel[] = [];
  let previous: Set<string> | null = null;
  for (const level of ASSISTANT_LEVELS) {
    const names = applyLevel(catalog, role, level);
    if (previous === null || !sameSet(names, previous)) kept.push(level);
    previous = names;
  }
  return kept;
}

export type AreaSwitchState = 'on' | 'off' | 'mixed';

export interface IAreaState {
  state: AreaSwitchState;
  /** Ticked, of what the role can have here. */
  offered: number;
  available: number;
  /** Shown disabled: the role's console cannot do these. */
  above: number;
}

export function areaState(
  area: IAbilityArea,
  role: PersonRole,
  on: ReadonlySet<string>,
): IAreaState {
  const within = area.abilities.filter((a) => !isAbove(a, role));
  const offered = within.filter((a) => on.has(a.name)).length;
  return {
    state:
      offered === 0 ? 'off' : offered === within.length ? 'on' : 'mixed',
    offered,
    available: within.length,
    above: area.abilities.length - within.length,
  };
}

/** Partly on and off both become on; on becomes off. */
export function toggleArea(
  area: IAbilityArea,
  role: PersonRole,
  on: ReadonlySet<string>,
): Set<string> {
  const within = area.abilities.filter((a) => !isAbove(a, role));
  const next = new Set(on);
  if (areaState(area, role, on).state === 'on') {
    for (const a of within) next.delete(a.name);
  } else {
    for (const a of within) next.add(a.name);
  }
  return next;
}

/** Everything in an area on, or off, within the role. */
export function setArea(
  area: IAbilityArea,
  role: PersonRole,
  on: ReadonlySet<string>,
  value: boolean,
): Set<string> {
  const next = new Set(on);
  for (const a of area.abilities) {
    if (isAbove(a, role)) continue;
    if (value) next.add(a.name);
    else next.delete(a.name);
  }
  return next;
}

/** The one-click way to "this level, but nothing that deletes". */
export function untickDestructive(
  catalog: IAssistantCatalog,
  on: ReadonlySet<string>,
): Set<string> {
  const destructive = new Set(
    abilitiesOf(catalog)
      .filter((a) => a.destructive)
      .map((a) => a.name),
  );
  return new Set([...on].filter((name) => !destructive.has(name)));
}

/** Areas with the abilities that match, areas with none left out. */
export function filterAreas(
  catalog: IAssistantCatalog,
  query: string,
  onlyWrites: boolean,
): IAbilityArea[] {
  const needle = query.trim().toLowerCase();
  return catalog.areas
    .map((area) => ({
      ...area,
      abilities: area.abilities.filter(
        (a) =>
          (!onlyWrites || a.effect === 'write') &&
          (needle === '' ||
            a.title.toLowerCase().includes(needle) ||
            a.name.toLowerCase().includes(needle)),
      ),
    }))
    .filter((area) => area.abilities.length > 0);
}

interface IChoice {
  enabled: boolean;
  level: AssistantLevelOrCustom;
  on?: readonly string[] | null;
}

const held = (
  catalog: IAssistantCatalog,
  role: PersonRole,
  choice: IChoice,
): Set<string> =>
  choice.enabled ? offeredNames(catalog, role, choice) : new Set<string>();

/** How many abilities people would lose going from one choice to another. */
export function lossSummary(
  catalog: IAssistantCatalog,
  role: PersonRole,
  before: IChoice,
  after: IChoice,
): number {
  const keep = held(catalog, role, after);
  return [...held(catalog, role, before)].filter((name) => !keep.has(name)).length;
}

/** Whether a change takes anything away. Such a change asks first. */
export function narrows(
  catalog: IAssistantCatalog,
  role: PersonRole,
  before: IChoice,
  after: IChoice,
): boolean {
  return lossSummary(catalog, role, before, after) > 0;
}

/** The line under an account's assistant setting. */
export function accountCaption(
  account: { role: PersonRole; source: 'owner' | 'role' | 'account' },
  hasAssistant: boolean,
): string {
  if (!hasAssistant) return 'No assistant yet.';
  if (account.source === 'owner') return 'The Owner always has everything.';
  if (account.source === 'account') return 'Set for this account';
  return `Same as all ${account.role}s`;
}

export const LEVEL_LABELS: Record<AssistantLevelOrCustom, string> = {
  basic: 'Basic',
  standard: 'Standard',
  full: 'Full',
  custom: 'Custom',
};

/** What a level is, in a line, for a tooltip. */
export const LEVEL_HINTS: Record<AssistantLevel, string> = {
  basic: 'See and ask. Changes nothing that belongs to anyone else.',
  standard:
    'Basic, plus day-to-day work on agents: create, start, stop, edit, files, knowledge, skills, colleagues, test runs.',
  full: 'Everything the role can do in the console.',
};

/** The person's own card beside their level: as wide as this, at most. */
export const BADGE_CARD_WIDTH = 288;
/** The room kept between that card and the edge of the screen. */
export const BADGE_CARD_GUTTER = 16;

/**
 * How far the card moves from the badge's left edge so that all of it is on
 * screen (CLEAN-257). The badge sits wherever the assistant's name ends; a
 * card hung from it would run off a phone. Zero while it fits; otherwise
 * left as far as needed, and never past the left gutter.
 */
export function badgeCardShift(
  left: number,
  viewport: number,
  width: number,
  gutter: number = BADGE_CARD_GUTTER,
): number {
  return Math.max(gutter - left, Math.min(0, viewport - gutter - width - left));
}
