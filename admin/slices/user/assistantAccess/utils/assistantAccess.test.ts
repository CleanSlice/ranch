import { describe, expect, test } from 'bun:test';
import type { IAbility, IAssistantCatalog } from '../domain/assistantAccess.types';
import {
  accountCaption,
  applyLevel,
  areaState,
  badgeCardShift,
  ceilingNames,
  filterAreas,
  isAbove,
  isOwnAgentsOnly,
  levelsFor,
  lossSummary,
  matchingLevel,
  narrows,
  offeredNames,
  toggleArea,
  untickDestructive,
} from './assistantAccess';

const ability = (
  name: string,
  area: string,
  effect: 'read' | 'write',
  minRole: 'Owner' | 'Admin' | 'User',
  levels: ('basic' | 'standard' | 'full')[],
  destructive = false,
  ownAgentsOnly = false,
): IAbility => ({
  name,
  title: `Title of ${name}`,
  area,
  effect,
  destructive,
  minRole,
  levels,
  ownAgentsOnly,
});

const ALL = ['basic', 'standard', 'full'] as const;
const CATALOG: IAssistantCatalog = {
  areas: [
    {
      key: 'agents',
      title: 'Agents',
      order: 10,
      abilities: [
        ability('list_agents', 'agents', 'read', 'User', [...ALL]),
        ability('restart_agent', 'agents', 'write', 'User', ['standard', 'full']),
        ability('delete_agent', 'agents', 'write', 'User', ['standard', 'full'], true),
      ],
    },
    {
      key: 'users_keys',
      title: 'Users & API keys',
      order: 110,
      abilities: [
        ability('list_users', 'users_keys', 'read', 'Admin', [...ALL]),
        ability('create_user', 'users_keys', 'write', 'Admin', ['full']),
        ability('delete_user', 'users_keys', 'write', 'Owner', ['full'], true),
      ],
    },
  ],
  alwaysOn: [ability('query_knowledge', 'knowledge', 'read', 'User', [])],
};

describe('what a role can have, and what a level gives it', () => {
  test('the ceiling of a role', () => {
    expect(ceilingNames(CATALOG, 'User')).toEqual(['list_agents', 'restart_agent', 'delete_agent']);
    expect(ceilingNames(CATALOG, 'Admin')).toEqual([
      'list_agents',
      'restart_agent',
      'delete_agent',
      'list_users',
      'create_user',
    ]);
  });

  test('a level, within the role', () => {
    expect([...applyLevel(CATALOG, 'Admin', 'basic')].sort()).toEqual(['list_agents', 'list_users']);
    expect([...applyLevel(CATALOG, 'Admin', 'standard')].sort()).toEqual([
      'delete_agent',
      'list_agents',
      'list_users',
      'restart_agent',
    ]);
    expect(applyLevel(CATALOG, 'Admin', 'full').has('delete_user')).toBe(false);
    expect([...applyLevel(CATALOG, 'User', 'full')].sort()).toEqual([
      'delete_agent',
      'list_agents',
      'restart_agent',
    ]);
  });

  test('a custom pick is cut to the role', () => {
    expect(
      [...offeredNames(CATALOG, 'User', { level: 'custom', on: ['list_agents', 'create_user'] })],
    ).toEqual(['list_agents']);
  });

  test('which level a pick equals, if any', () => {
    expect(matchingLevel(CATALOG, 'Admin', new Set(['list_agents', 'list_users']))).toBe('basic');
    expect(matchingLevel(CATALOG, 'Admin', new Set(['list_agents']))).toBe(null);
  });

  // For a User everything above Standard is above the role, so Full is the
  // same set; the console shows two levels.
  test('Users get two levels, Admins three', () => {
    expect(levelsFor(CATALOG, 'Admin')).toEqual(['basic', 'standard', 'full']);
    expect(levelsFor(CATALOG, 'User')).toEqual(['basic', 'standard']);
  });
});

describe('an area in the Advanced panel', () => {
  test('on, off, partly on, with counts within the role', () => {
    const [agents, users] = CATALOG.areas;
    expect(areaState(agents!, 'Admin', new Set(['list_agents', 'restart_agent', 'delete_agent']))).toEqual({
      state: 'on',
      offered: 3,
      available: 3,
      above: 0,
    });
    const partly = areaState(agents!, 'Admin', new Set(['list_agents']));
    expect([partly.state, partly.offered]).toEqual(['mixed', 1]);
    const none = areaState(agents!, 'Admin', new Set());
    expect([none.state, none.offered]).toEqual(['off', 0]);
    // One of three is the Owner's alone: shown, counted apart, never tickable.
    expect(areaState(users!, 'Admin', new Set(['list_users', 'create_user']))).toEqual({
      state: 'on',
      offered: 2,
      available: 2,
      above: 1,
    });
    expect(areaState(users!, 'User', new Set())).toEqual({ state: 'off', offered: 0, available: 0, above: 3 });
  });

  test('clicking partly-on or off turns it on; clicking on turns it off', () => {
    const [agents] = CATALOG.areas;
    expect([...toggleArea(agents!, 'Admin', new Set(['list_agents']))].sort()).toEqual([
      'delete_agent',
      'list_agents',
      'restart_agent',
    ]);
    expect([...toggleArea(agents!, 'Admin', new Set(['list_agents', 'restart_agent', 'delete_agent', 'list_users']))]).toEqual([
      'list_users',
    ]);
  });

  test('never ticks what is above the role', () => {
    const [, users] = CATALOG.areas;
    expect([...toggleArea(users!, 'Admin', new Set())].sort()).toEqual(['create_user', 'list_users']);
    expect(isAbove(users!.abilities[2]!, 'Admin')).toBe(true);
    expect(isAbove(users!.abilities[1]!, 'User')).toBe(true);
    expect(isAbove(users!.abilities[1]!, 'Admin')).toBe(false);
  });

  test('untick everything that deletes', () => {
    expect(
      [...untickDestructive(CATALOG, new Set(['list_agents', 'restart_agent', 'delete_agent']))].sort(),
    ).toEqual(['list_agents', 'restart_agent']);
  });

  test('search and "only the ones that change things" keep the grouping', () => {
    expect(filterAreas(CATALOG, 'restart', false).map((a) => [a.key, a.abilities.map((x) => x.name)])).toEqual([
      ['agents', ['restart_agent']],
    ]);
    expect(filterAreas(CATALOG, '', true).map((a) => a.abilities.map((x) => x.name))).toEqual([
      ['restart_agent', 'delete_agent'],
      ['create_user', 'delete_user'],
    ]);
    expect(filterAreas(CATALOG, '  ', false).length).toBe(2);
    expect(filterAreas(CATALOG, 'nothing like this', false)).toEqual([]);
  });
});

describe('before a change is saved', () => {
  const full = { enabled: true, level: 'full' as const };

  test('a lower level and off narrow; a higher level and on do not', () => {
    expect(narrows(CATALOG, 'Admin', full, { enabled: true, level: 'standard' })).toBe(true);
    expect(narrows(CATALOG, 'Admin', full, { enabled: false, level: 'full' })).toBe(true);
    expect(narrows(CATALOG, 'Admin', { enabled: true, level: 'basic' }, { enabled: true, level: 'standard' })).toBe(false);
    expect(narrows(CATALOG, 'Admin', { enabled: false, level: 'basic' }, { enabled: true, level: 'basic' })).toBe(false);
    // The same set under another name loses nothing.
    expect(narrows(CATALOG, 'User', { enabled: true, level: 'full' }, { enabled: true, level: 'standard' })).toBe(false);
  });

  test('how many abilities would be lost', () => {
    expect(lossSummary(CATALOG, 'Admin', full, { enabled: true, level: 'basic' })).toBe(3);
    expect(lossSummary(CATALOG, 'Admin', full, { enabled: false, level: 'full' })).toBe(5);
    expect(lossSummary(CATALOG, 'Admin', { enabled: true, level: 'basic' }, full)).toBe(0);
  });
});

describe('the line under an account’s assistant setting', () => {
  test('where it comes from', () => {
    expect(accountCaption({ role: 'Admin', source: 'role' }, true)).toBe('Same as all Admins');
    expect(accountCaption({ role: 'User', source: 'role' }, true)).toBe('Same as all Users');
    expect(accountCaption({ role: 'Admin', source: 'account' }, true)).toBe('Set for this account');
    expect(accountCaption({ role: 'Owner', source: 'owner' }, true)).toBe('The Owner always has everything.');
    expect(accountCaption({ role: 'Admin', source: 'role' }, false)).toBe('No assistant yet.');
  });
});

describe('an ability that stays with the agent’s creator', () => {
  const logs = ability('get_agent_logs', 'agents', 'read', 'User', [...ALL], false, true);
  const restart = ability('restart_agent', 'agents', 'write', 'User', ['standard', 'full']);

  test('is marked for a User, who gets it on agents they created only', () => {
    expect(isOwnAgentsOnly(logs, 'User')).toBe(true);
    expect(isOwnAgentsOnly(restart, 'User')).toBe(false);
  });

  test('is not marked for an Admin or the Owner, who manage by role', () => {
    expect(isOwnAgentsOnly(logs, 'Admin')).toBe(false);
    expect(isOwnAgentsOnly(logs, 'Owner')).toBe(false);
  });

  test('stays tickable and counted: the creator uses it', () => {
    const catalog: IAssistantCatalog = {
      areas: [{ key: 'agents', title: 'Agents', order: 10, abilities: [logs, restart] }],
      alwaysOn: [],
    };
    expect(isAbove(logs, 'User')).toBe(false);
    expect(ceilingNames(catalog, 'User')).toEqual(['get_agent_logs', 'restart_agent']);
    expect(areaState(catalog.areas[0]!, 'User', new Set(['get_agent_logs']))).toEqual({
      state: 'mixed',
      offered: 1,
      available: 2,
      above: 0,
    });
  });
});

describe('where the person’s own card hangs', () => {
  test('from the badge while it fits', () => {
    expect(badgeCardShift(24, 1440, 288)).toBe(0);
    expect(badgeCardShift(16, 390, 288)).toBe(0);
  });

  test('moved left on a phone, as far as it takes and no further', () => {
    // 390 wide, badge at 200: the card would end at 488.
    const shift = badgeCardShift(200, 390, 288);
    expect(shift).toBe(-114);
    expect(200 + shift + 288).toBe(390 - 16);
  });

  test('never past the left gutter, on a screen narrower than the card', () => {
    const width = 320 - 32;
    const shift = badgeCardShift(250, 320, width);
    expect(250 + shift).toBe(16);
    expect(250 + shift + width).toBe(320 - 16);
  });
});
