import { AgentReach } from '../domain/agentAccess.types';
import { AgentAccessMapper } from './agentAccess.mapper';

/**
 * The read of one account's access starts from the account itself
 * (CLEAN-231), so that three cases stay apart: an account that does not
 * exist, one nobody edited, and one with a row.
 */
const mapper = new AgentAccessMapper();
const at = new Date('2026-11-17T10:00:00.000Z');

describe('AgentAccessMapper.toAccountState', () => {
  it('no row at all: there is no such account, and it reaches nothing', () => {
    const state = mapper.toAccountState('user-gone', []);
    expect(state).toEqual({
      userId: 'user-gone',
      limited: false,
      entries: [],
      updatedAt: null,
      accountMissing: true,
    });
    expect(new AgentReach(state).has('agent-a')).toBe(false);
  });

  it('the account with no access row: nobody edited it, it reaches every agent', () => {
    const state = mapper.toAccountState('user-1', [
      { userId: 'user-1', limited: null, updatedAt: null, agentId: null, list: null },
    ]);
    expect(state).toEqual({
      userId: 'user-1',
      limited: false,
      entries: [],
      updatedAt: null,
    });
    expect(new AgentReach(state).has('agent-a')).toBe(true);
  });

  it('the account with a row and entries', () => {
    const row = { userId: 'user-1', limited: true, updatedAt: at };
    const state = mapper.toAccountState('user-1', [
      { ...row, agentId: 'agent-a', list: 'allowed' },
      { ...row, agentId: 'agent-b', list: 'denied' },
      // A list this code does not know grants and denies nothing.
      { ...row, agentId: 'agent-c', list: 'maybe' },
    ]);
    expect(state).toEqual({
      userId: 'user-1',
      limited: true,
      entries: [
        { agentId: 'agent-a', list: 'allowed' },
        { agentId: 'agent-b', list: 'denied' },
      ],
      updatedAt: at,
    });
  });

  it('a limited account whose entries are all gone stays limited: needs review, not everything', () => {
    const state = mapper.toAccountState('user-1', [
      { userId: 'user-1', limited: true, updatedAt: at, agentId: null, list: null },
    ]);
    expect(state.limited).toBe(true);
    expect(state.accountMissing).toBeUndefined();
    expect(new AgentReach(state).has('agent-a')).toBe(false);
  });
});
