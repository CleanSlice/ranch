import { describe, expect, test } from 'bun:test';
import {
  accessBadges,
  accessManagement,
  applyChoices,
  changedAgents,
  choiceOf,
  filterByName,
  managedByLine,
  outcomeSentence,
  predictOutcome,
  type IAccessStored,
} from './outcome';

const stored = (over: Partial<IAccessStored> = {}): IAccessStored => ({
  allowed: [],
  denied: [],
  outcome: { kind: 'all', count: 0 },
  hasEntriesOutsideView: false,
  ...over,
});

describe('the outcome sentence', () => {
  test('one sentence per kind, as data-model.md words them', () => {
    expect(outcomeSentence({ kind: 'all', count: 0 })).toBe('Reaches every agent');
    expect(outcomeSentence({ kind: 'all_except', count: 2 })).toBe(
      'Reaches every agent except 2',
    );
    expect(outcomeSentence({ kind: 'only', count: 3 })).toBe('Reaches only these 3');
    expect(outcomeSentence({ kind: 'none', count: 0 })).toBe(
      'Reaches no agents — needs review',
    );
  });

  test('denied only agents the viewer cannot see: no "except 0"', () => {
    expect(outcomeSentence({ kind: 'all_except', count: 0 })).toBe(
      'Reaches every agent you can see',
    );
    const p = predictOutcome(
      stored({ outcome: { kind: 'all_except', count: 0 }, hasEntriesOutsideView: true }),
      { allowed: [], denied: [] },
    );
    expect(p.outcome).toEqual({ kind: 'all_except', count: 0 });
  });

  test('limited to agents the viewer cannot see: no "these 0"', () => {
    expect(outcomeSentence({ kind: 'only', count: 0 })).toBe(
      'Reaches only agents you cannot manage',
    );
  });
});

describe('one choice per row', () => {
  test('the stored choice of an agent', () => {
    const lists = { allowed: ['a'], denied: ['b'] };
    expect(choiceOf('a', lists)).toBe('allowed');
    expect(choiceOf('b', lists)).toBe('denied');
    expect(choiceOf('c', lists)).toBe('none');
  });

  test('pending choices are laid over the stored lists', () => {
    const next = applyChoices(
      { allowed: ['a', 'b'], denied: ['c'] },
      { a: 'denied', c: 'none', d: 'allowed' },
    );
    expect(next.allowed).toEqual(['b', 'd']);
    expect(next.denied).toEqual(['a']);
  });

  test('an agent never ends on both lists', () => {
    const next = applyChoices({ allowed: ['a'], denied: ['a'] }, {});
    expect(next.allowed).toEqual([]);
    expect(next.denied).toEqual(['a']);
    const moved = applyChoices({ allowed: ['a'], denied: [] }, { a: 'denied' });
    expect(moved.allowed).toEqual([]);
    expect(moved.denied).toEqual(['a']);
  });

  test('a choice put back to what is stored is not a change', () => {
    const lists = { allowed: ['a'], denied: [] };
    expect(changedAgents(lists, { a: 'allowed', b: 'none' })).toEqual([]);
    expect(changedAgents(lists, { a: 'none', b: 'denied' })).toEqual(['a', 'b']);
  });
});

describe('what a pending change would come to', () => {
  test('an allowed agent limits the account to its allowed agents', () => {
    const p = predictOutcome(stored(), { allowed: ['a', 'b'], denied: ['c'] });
    expect(p.outcome).toEqual({ kind: 'only', count: 2 });
    expect(p.opens).toBe(false);
  });

  test('an open account with denials stays open', () => {
    const p = predictOutcome(stored(), { allowed: [], denied: ['a'] });
    expect(p.outcome).toEqual({ kind: 'all_except', count: 1 });
    expect(p.opens).toBe(false);
    expect(predictOutcome(stored(), { allowed: [], denied: [] }).outcome).toEqual({
      kind: 'all',
      count: 0,
    });
  });

  test('removing the last allowed agent opens the account', () => {
    const p = predictOutcome(
      stored({ allowed: ['a'], outcome: { kind: 'only', count: 1 } }),
      { allowed: [], denied: ['b'] },
    );
    expect(p.outcome).toEqual({ kind: 'all_except', count: 1 });
    expect(p.opens).toBe(true);
    expect(p.certain).toBe(true);
  });

  test('an account that needs review opens on any save without an allowed agent', () => {
    const p = predictOutcome(stored({ outcome: { kind: 'none', count: 0 } }), {
      allowed: [],
      denied: [],
    });
    expect(p.outcome).toEqual({ kind: 'all', count: 0 });
    expect(p.opens).toBe(true);
    expect(p.certain).toBe(true);
  });

  test('an Admin cannot tell when the account may hold allowed agents outside their view', () => {
    const p = predictOutcome(
      stored({
        allowed: ['a'],
        outcome: { kind: 'only', count: 1 },
        hasEntriesOutsideView: true,
      }),
      { allowed: [], denied: [] },
    );
    expect(p.opens).toBe(true);
    expect(p.certain).toBe(false);
  });

  test('limited by agents outside the view only: it stays limited', () => {
    const p = predictOutcome(
      stored({ outcome: { kind: 'only', count: 0 }, hasEntriesOutsideView: true }),
      { allowed: [], denied: ['a'] },
    );
    expect(p.outcome).toEqual({ kind: 'only', count: 0 });
    expect(p.opens).toBe(false);
  });
});

describe('who may edit whom', () => {
  const owner = { id: 'o', role: 'Owner' };
  const admin = { id: 'a', role: 'Admin' };
  const admin2 = { id: 'a2', role: 'Admin' };
  const user = { id: 'u', role: 'User' };

  test('the Owner edits Admins and Users, never the Owner account', () => {
    expect(accessManagement(owner, admin)).toBe('editable');
    expect(accessManagement(owner, user)).toBe('editable');
    expect(accessManagement(owner, owner)).toBe('owner');
  });

  test('an Admin edits Users, not themselves, another Admin or the Owner', () => {
    expect(accessManagement(admin, user)).toBe('editable');
    expect(accessManagement(admin, admin)).toBe('self');
    expect(accessManagement(admin, admin2)).toBe('other_admin');
    expect(accessManagement(admin, owner)).toBe('owner');
  });

  test('a User, or nobody, edits nothing', () => {
    expect(accessManagement(user, admin)).toBe('none');
    expect(accessManagement(null, user)).toBe('none');
  });

  test('every reason has its line', () => {
    expect(
      managedByLine('owner').startsWith('The Owner reaches every agent.'),
    ).toBe(true);
    expect(managedByLine('self')).toBe('Your own agent access is managed by the Owner.');
    expect(managedByLine('other_admin')).toBe(
      "An Admin's agent access is managed by the Owner.",
    );
  });
});

describe('the filter and the list marks', () => {
  test('filters by agent name, case-insensitively', () => {
    const agents = [{ name: 'Alpha' }, { name: 'bravo' }, { name: 'alphabet' }];
    expect(filterByName(agents, ' ALPH ').map((a) => a.name)).toEqual([
      'Alpha',
      'alphabet',
    ]);
    expect(filterByName(agents, '').length).toBe(3);
  });

  test('"Restricted" unless the account reaches every agent', () => {
    expect(accessBadges({ kind: 'all', needsReview: false })).toEqual({
      restricted: false,
      needsReview: false,
    });
    expect(accessBadges({ kind: 'all_except', needsReview: false }).restricted).toBe(true);
    expect(accessBadges({ kind: 'only', needsReview: false }).restricted).toBe(true);
    expect(accessBadges({ kind: 'none', needsReview: true })).toEqual({
      restricted: true,
      needsReview: true,
    });
    expect(accessBadges(null)).toEqual({ restricted: false, needsReview: false });
  });
});
