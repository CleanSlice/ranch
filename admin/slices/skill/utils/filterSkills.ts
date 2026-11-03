import type { SkillGroup } from '../domain/skill.groups';

/**
 * The search box and the group chips of the Skills page (CLEAN-205). Pure,
 * so the "no skills match" state and the chip counts are pinned by tests.
 */
export type GroupFilter = 'all' | 'none' | SkillGroup;

export interface FilterableSkill {
  name: string;
  title: string;
  description: string | null;
  group: SkillGroup | null;
}

/** Case-insensitive substring over slug, title and description. */
export function matchesQuery(skill: FilterableSkill, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [skill.name, skill.title, skill.description ?? '']
    .some((field) => field.toLowerCase().includes(needle));
}

export function matchesGroup(skill: FilterableSkill, group: GroupFilter): boolean {
  if (group === 'all') return true;
  if (group === 'none') return skill.group === null;
  return skill.group === group;
}

export function filterSkills<T extends FilterableSkill>(
  skills: readonly T[],
  filter: { q: string; group: GroupFilter },
): T[] {
  return skills.filter((s) => matchesGroup(s, filter.group) && matchesQuery(s, filter.q));
}

/**
 * Counts for the chips, over the whole library (not the current search), so
 * a chip always says what it would show. `none` is present only while some
 * skill has no group — the chip appears and disappears with the data.
 */
export function groupCounts(
  skills: readonly FilterableSkill[],
): { all: number; none: number; byGroup: Partial<Record<SkillGroup, number>> } {
  const byGroup: Partial<Record<SkillGroup, number>> = {};
  let none = 0;
  for (const s of skills) {
    if (s.group === null) none++;
    else byGroup[s.group] = (byGroup[s.group] ?? 0) + 1;
  }
  return { all: skills.length, none, byGroup };
}
