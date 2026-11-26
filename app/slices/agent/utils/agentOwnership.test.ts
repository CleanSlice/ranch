import { describe, expect, test } from 'bun:test';
import {
  agentCreator,
  creatorInitials,
  effectiveOwnerFilter,
  filterByOwner,
  ownAgents,
  ownerMark,
  ownershipNote,
} from './agentOwnership';

// Twin of admin/slices/agent/agent/utils/agentOwnership.test.ts.
const agent = (over: Partial<Parameters<typeof agentCreator>[0]> = {}) => ({
  isAdmin: false,
  createdByMe: false,
  createdBy: null,
  ...over,
});
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
  test('the viewer’s own agent is theirs, whatever their role', () => {
    for (const role of ['Owner', 'Admin', 'User']) {
      expect(agentCreator(agent({ createdByMe: true }), role)).toEqual({ kind: 'mine' });
    }
  });

  test('a User is told nothing about anybody else’s agent', () => {
    expect(agentCreator(agent(), 'User')).toBe(null);
    // Even if a creator came with the record, which the API never sends them.
    expect(agentCreator(agent({ createdBy: anna }), 'User')).toBe(null);
    expect(agentCreator(agent({ createdBy: anna }), null)).toBe(null);
  });

  test('an operator reads the creator’s name and initials', () => {
    expect(agentCreator(agent({ createdBy: anna }), 'Admin')).toEqual({
      kind: 'other',
      name: 'Anna Kovacs',
      initials: 'AK',
    });
    expect(
      agentCreator(agent({ createdBy: { name: null, email: 'anna@ranch.test' } }), 'Owner'),
    ).toEqual({ kind: 'other', name: 'anna@ranch.test', initials: 'AR' });
  });

  test('an operator is told when nobody is recorded, and when the account is gone', () => {
    expect(agentCreator(agent(), 'Owner')).toEqual({ kind: 'unknown' });
    expect(
      agentCreator(agent({ createdBy: { name: null, email: null } }), 'Admin'),
    ).toEqual({ kind: 'removed' });
  });
});

describe('ownerMark', () => {
  test('filled for one’s own, initials for somebody else’s, nothing otherwise', () => {
    expect(ownerMark(agent({ createdByMe: true }), 'User')).toEqual({ kind: 'mine' });
    expect(ownerMark(agent({ createdBy: anna }), 'Admin')?.kind).toBe('other');
    // No backfill: an agent with no recorded creator is unmarked.
    expect(ownerMark(agent(), 'Owner')).toBe(null);
    expect(ownerMark(agent({ createdBy: { name: null, email: null } }), 'Owner')).toBe(null);
    expect(ownerMark(agent(), 'User')).toBe(null);
  });
});

describe('the filter', () => {
  const list = [
    { id: 'a', createdByMe: false },
    { id: 'b', createdByMe: true },
    { id: 'c', createdByMe: true },
  ];

  test('"mine" is read off the records, in their order', () => {
    expect(ownAgents(list).map((a) => a.id)).toEqual(['b', 'c']);
    expect(filterByOwner(list, 'mine').map((a) => a.id)).toEqual(['b', 'c']);
    expect(filterByOwner(list, 'all').map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  test('"Mine" with nothing of one’s own is "All"', () => {
    expect(effectiveOwnerFilter('mine', 2)).toBe('mine');
    expect(effectiveOwnerFilter('mine', 0)).toBe('all');
    expect(effectiveOwnerFilter('all', 2)).toBe('all');
  });
});

describe('ownershipNote', () => {
  test('one’s own agent: a User is told their role has none of it elsewhere', () => {
    expect(ownershipNote(agent({ createdByMe: true }), 'User')).toEqual({
      kind: 'mine',
      byRoleToo: false,
    });
    expect(ownershipNote(agent({ createdByMe: true }), 'Admin')).toEqual({
      kind: 'mine',
      byRoleToo: true,
    });
  });

  test('somebody else’s, for a User: available, or what the assistant may do', () => {
    expect(ownershipNote(agent(), 'User')).toEqual({ kind: 'available' });
    expect(ownershipNote(agent(), 'User', ['Restart an agent'])).toEqual({
      kind: 'assistant',
      abilities: ['Restart an agent'],
    });
  });

  test('never more than one: one’s own wins over what the assistant may do', () => {
    expect(ownershipNote(agent({ createdByMe: true }), 'User', ['Restart an agent'])?.kind).toBe(
      'mine',
    );
  });

  test('none for an operator on somebody else’s agent', () => {
    expect(ownershipNote(agent({ createdBy: anna }), 'Admin')).toBe(null);
    expect(ownershipNote(agent(), 'Owner', ['Restart an agent'])).toBe(null);
  });

  test('none on the Ranch admin agent, for anybody', () => {
    const ranch = agent({ isAdmin: true });
    expect(ownershipNote(ranch, 'User', ['Restart an agent'])).toBe(null);
    expect(ownershipNote(ranch, 'Admin')).toBe(null);
    expect(ownershipNote({ ...ranch, createdByMe: true }, 'Owner')).toBe(null);
  });
});
