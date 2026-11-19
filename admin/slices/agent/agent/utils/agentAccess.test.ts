import { describe, expect, test } from 'bun:test';
import {
  OWNER_MANAGED_TEXT,
  canManageAgent,
  isOwnerRole,
} from './agentAccess';

const ranchAdmin = { isAdmin: true };
const ordinary = { isAdmin: false };

describe('canManageAgent', () => {
  test('the Owner manages the Ranch admin agent', () => {
    expect(canManageAgent('Owner', ranchAdmin)).toBe(true);
  });

  test('an Admin does not manage the Ranch admin agent', () => {
    expect(canManageAgent('Admin', ranchAdmin)).toBe(false);
  });

  test('an Admin manages every other agent', () => {
    expect(canManageAgent('Admin', ordinary)).toBe(true);
  });

  test('the Owner manages every other agent', () => {
    expect(canManageAgent('Owner', ordinary)).toBe(true);
  });

  test('nobody but the Owner manages the Ranch admin agent', () => {
    expect(canManageAgent('User', ranchAdmin)).toBe(false);
    expect(canManageAgent('', ranchAdmin)).toBe(false);
    expect(canManageAgent(null, ranchAdmin)).toBe(false);
    expect(canManageAgent(undefined, ranchAdmin)).toBe(false);
  });

  test('the role is matched exactly', () => {
    expect(canManageAgent('owner', ranchAdmin)).toBe(false);
    expect(canManageAgent('OWNER', ranchAdmin)).toBe(false);
  });
});

describe('isOwnerRole', () => {
  test('is true for the Owner only', () => {
    expect(isOwnerRole('Owner')).toBe(true);
    expect(isOwnerRole('Admin')).toBe(false);
    expect(isOwnerRole(null)).toBe(false);
    expect(isOwnerRole(undefined)).toBe(false);
  });
});

describe('OWNER_MANAGED_TEXT', () => {
  test('is the one line the workspace shows', () => {
    expect(OWNER_MANAGED_TEXT).toBe('This agent is managed by the Owner.');
  });
});
