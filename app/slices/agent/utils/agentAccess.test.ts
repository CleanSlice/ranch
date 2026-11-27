import { describe, expect, test } from 'bun:test';
import { canManageAgent, canPinAgent, canShareAgent } from './agentAccess';

// Twin of admin/slices/agent/agent/utils/agentAccess.test.ts: the line about
// the Ranch admin agent is the same in both consoles (CLEAN-232).
const ranchAdmin = { isAdmin: true };
const ordinary = { isAdmin: false };

describe('canPinAgent', () => {
  // CLEAN-269: the Ranch assistant is first in every list as it is.
  test('there is no pin on the Ranch admin agent, for any role', () => {
    expect(canPinAgent(ranchAdmin)).toBe(false);
  });

  test('every other agent is pinned by whoever sees it', () => {
    expect(canPinAgent(ordinary)).toBe(true);
  });
});

describe('canShareAgent', () => {
  test('whoever opens an ordinary agent may share it', () => {
    for (const role of ['Owner', 'Admin', 'User']) {
      expect(canShareAgent(role, ordinary)).toBe(true);
    }
  });

  test('the share link of the Ranch admin agent is the Owner\'s alone', () => {
    expect(canShareAgent('Owner', ranchAdmin)).toBe(true);
    expect(canShareAgent('Admin', ranchAdmin)).toBe(false);
    expect(canShareAgent('User', ranchAdmin)).toBe(false);
    expect(canShareAgent(null, ranchAdmin)).toBe(false);
  });
});

describe('canManageAgent', () => {
  test('the Owner manages the Ranch admin agent', () => {
    expect(canManageAgent('Owner', ranchAdmin)).toBe(true);
  });

  test('an Admin does not manage the Ranch admin agent', () => {
    expect(canManageAgent('Admin', ranchAdmin)).toBe(false);
  });

  test('an Owner and an Admin manage every other agent', () => {
    expect(canManageAgent('Owner', ordinary)).toBe(true);
    expect(canManageAgent('Admin', ordinary)).toBe(true);
  });

  test('a User manages no agent somebody else created', () => {
    expect(canManageAgent('User', ordinary)).toBe(false);
    expect(canManageAgent('User', ranchAdmin)).toBe(false);
    expect(canManageAgent('User', { isAdmin: false, createdByMe: false })).toBe(false);
  });

  test('a User manages the agent they created, but never the Ranch admin agent', () => {
    expect(canManageAgent('User', { isAdmin: false, createdByMe: true })).toBe(true);
    expect(canManageAgent('User', { isAdmin: true, createdByMe: true })).toBe(false);
    expect(canManageAgent('Admin', { isAdmin: true, createdByMe: true })).toBe(false);
    // Nobody signed in created nothing.
    expect(canManageAgent(null, { isAdmin: false, createdByMe: true })).toBe(false);
  });

  test('nobody signed in manages no agent', () => {
    expect(canManageAgent(null, ordinary)).toBe(false);
    expect(canManageAgent(undefined, ordinary)).toBe(false);
    expect(canManageAgent('', ranchAdmin)).toBe(false);
  });

  test('the role is matched exactly', () => {
    expect(canManageAgent('owner', ranchAdmin)).toBe(false);
    expect(canManageAgent('admin', ordinary)).toBe(false);
  });
});
