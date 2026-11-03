import { describe, expect, test } from 'bun:test';
import { filterSkills, groupCounts, matchesQuery } from './filterSkills';
import type { SkillGroup } from '../domain/skill.groups';

const s = (name: string, title: string, description: string | null, group: SkillGroup | null) => ({
  name,
  title,
  description,
  group,
});

const library = [
  s('alm-api', 'alm-api', 'Adobe Learning Manager Prime API v2', 'api'),
  s('mazda-intent-router', 'Intent router', 'routes queries to ALM or Reporting', 'routing'),
  s('skill-creator', 'Skill creator', null, null),
];

describe('matchesQuery', () => {
  test('ignores case and searches slug, title and description', () => {
    expect(matchesQuery(library[0]!, 'ADOBE')).toBe(true);
    expect(matchesQuery(library[1]!, 'intent')).toBe(true);
    expect(matchesQuery(library[1]!, 'mazda-intent')).toBe(true);
    expect(matchesQuery(library[2]!, 'adobe')).toBe(false);
  });

  test('blank query matches everything, a null description is not an error', () => {
    expect(matchesQuery(library[2]!, '   ')).toBe(true);
  });
});

describe('filterSkills', () => {
  test('group and query combine', () => {
    expect(filterSkills(library, { q: 'alm', group: 'all' }).map((x) => x.name)).toEqual([
      'alm-api',
      'mazda-intent-router',
    ]);
    expect(filterSkills(library, { q: 'alm', group: 'routing' }).map((x) => x.name)).toEqual([
      'mazda-intent-router',
    ]);
    expect(filterSkills(library, { q: '', group: 'none' }).map((x) => x.name)).toEqual(['skill-creator']);
  });
});

describe('groupCounts', () => {
  test('whole-library counts, ungrouped counted apart', () => {
    expect(groupCounts(library)).toEqual({
      all: 3,
      none: 1,
      byGroup: { api: 1, routing: 1 },
    });
  });
});
