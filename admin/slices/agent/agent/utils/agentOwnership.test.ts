import { describe, expect, test } from 'bun:test';
import {
  agentCreator,
  creatorInitials,
  creatorText,
  effectiveOwnerFilter,
  filterByOwner,
  ownAgents,
  ownerMark,
  ownerMarkText,
} from './agentOwnership';

// Twin of app/slices/agent/utils/agentOwnership.test.ts.
const anna = { name: 'Anna Kovacs', email: 'anna@ranch.test' };

describe('creatorInitials', () => {
  test('two words give two letters', () => {
    expect(creatorInitials('Dmitriy Zhuk')).toBe('DZ');
    expect(creatorInitials('  anna  maria  kovacs ')).toBe('AM');
  });

  test('a login or an email is split where a name would be', () => {
    expect(creatorInitials('access-admin')).toBe('AA');
    expect(creatorInitials('d.zhuk@ranch.test')).toBe('DZ');
  });

  test('one word gives one letter, nothing gives a question mark', () => {
    expect(creatorInitials('maksym')).toBe('M');
    expect(creatorInitials('  ')).toBe('?');
  });
});

describe('agentCreator', () => {
  test('the viewer’s own agent is theirs, whoever else is named', () => {
    expect(agentCreator({ createdByMe: true, createdBy: anna })).toEqual({ kind: 'mine' });
    expect(agentCreator({ createdByMe: true, createdBy: null })).toEqual({ kind: 'mine' });
  });

  test('somebody else’s: the name, or the email when there is no name', () => {
    expect(agentCreator({ createdByMe: false, createdBy: anna })).toEqual({
      kind: 'other',
      name: 'Anna Kovacs',
      initials: 'AK',
    });
    expect(agentCreator({ createdBy: { name: null, email: 'anna@ranch.test' } })).toEqual({
      kind: 'other',
      name: 'anna@ranch.test',
      initials: 'AR',
    });
  });

  test('nobody recorded, and an account that is gone', () => {
    expect(agentCreator({ createdBy: null })).toEqual({ kind: 'unknown' });
    expect(agentCreator({})).toEqual({ kind: 'unknown' });
    expect(agentCreator({ createdBy: { name: null, email: null } })).toEqual({ kind: 'removed' });
  });
});

describe('what the header and the badge say', () => {
  test('the header line, one wording per state', () => {
    expect(creatorText({ kind: 'mine' })).toBe('Your agent');
    expect(creatorText({ kind: 'other', name: 'Anna Kovacs', initials: 'AK' })).toBe('by Anna Kovacs');
    expect(creatorText({ kind: 'unknown' })).toBe('creator not recorded');
    expect(creatorText({ kind: 'removed' })).toBe('created by a removed account');
  });

  test('a badge for one’s own and for a named creator, none otherwise', () => {
    expect(ownerMark({ createdByMe: true })).toEqual({ kind: 'mine' });
    expect(ownerMark({ createdBy: anna })?.kind).toBe('other');
    // No backfill: an agent with no recorded creator is unmarked.
    expect(ownerMark({ createdBy: null })).toBe(null);
    expect(ownerMark({ createdBy: { name: null, email: null } })).toBe(null);
  });

  test('the badge in words, for the row’s name', () => {
    expect(ownerMarkText({ kind: 'mine' })).toBe('created by you');
    expect(ownerMarkText({ kind: 'other', name: 'Anna Kovacs', initials: 'AK' })).toBe(
      'created by Anna Kovacs',
    );
  });
});

describe('the filter', () => {
  const list: { id: string; createdByMe?: boolean }[] = [
    { id: 'a', createdByMe: false },
    { id: 'b', createdByMe: true },
    { id: 'c', createdByMe: true },
    { id: 'd' },
  ];

  test('"mine" is read off the records, in their order', () => {
    expect(ownAgents(list).map((a) => a.id)).toEqual(['b', 'c']);
    expect(filterByOwner(list, 'mine').map((a) => a.id)).toEqual(['b', 'c']);
    expect(filterByOwner(list, 'all').map((a) => a.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('"Mine" with nothing of one’s own is "All"', () => {
    expect(effectiveOwnerFilter('mine', 2)).toBe('mine');
    expect(effectiveOwnerFilter('mine', 0)).toBe('all');
    expect(effectiveOwnerFilter('all', 2)).toBe('all');
  });
});
