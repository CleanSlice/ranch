import { describe, expect, test } from 'bun:test';
import {
  OWNER_MANAGED_TEXT,
  canManageAgent,
  canPinAgent,
  isOwnerRole,
  notAvailableText,
  ownerOnlyAssistant,
  ownerOnlyLeftOutText,
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

describe('canPinAgent', () => {
  // CLEAN-269: the Ranch assistant is first in every list as it is.
  test('there is no pin on the Ranch admin agent, for any role', () => {
    expect(canPinAgent(ranchAdmin)).toBe(false);
  });

  test('every other agent is pinned by whoever sees it', () => {
    expect(canPinAgent(ordinary)).toBe(true);
  });
});

// CLEAN-269: what Ranch keeps about its assistant is the Owner's to read.
describe('ownerOnlyAssistant', () => {
  const agents = [
    { id: 'a', name: 'Alpha', isAdmin: false },
    { id: 'r', name: 'Rancher', isAdmin: true },
  ];

  test('is the assistant for an Admin who has it', () => {
    expect(ownerOnlyAssistant('Admin', agents)?.id).toBe('r');
  });

  test('is nobody for the Owner, who reads everything', () => {
    expect(ownerOnlyAssistant('Owner', agents)).toBe(null);
  });

  test('is nobody for a viewer whose agents do not include the assistant', () => {
    expect(ownerOnlyAssistant('Admin', [agents[0]!])).toBe(null);
    expect(ownerOnlyAssistant('Admin', [])).toBe(null);
  });
});

describe('ownerOnlyLeftOutText', () => {
  test("is the sentence the assistant's tools give, without their last clause", () => {
    expect(ownerOnlyLeftOutText('usage figures', 'Rancher')).toBe(
      'The usage figures of Rancher, the Ranch assistant, are not included: only the Owner can read them.',
    );
    expect(ownerOnlyLeftOutText('conversations', ' Rancher ')).toBe(
      'The conversations of Rancher, the Ranch assistant, are not included: only the Owner can read them.',
    );
  });

  test('names the assistant by what it is when it has no name', () => {
    expect(ownerOnlyLeftOutText('evaluations', '  ')).toBe(
      'The evaluations of the Ranch assistant are not included: only the Owner can read them.',
    );
  });
});

describe('notAvailableText', () => {
  test('does not tell anybody but the Owner which of the two it was', () => {
    expect(notAvailableText('Admin')).toBe('It does not exist, or it is not yours to read.');
    expect(notAvailableText(null)).toBe('It does not exist, or it is not yours to read.');
  });

  test('tells the Owner, for whom nothing is out of reach', () => {
    expect(notAvailableText('Owner')).toBe('It does not exist, or it was removed.');
  });
});

describe('OWNER_MANAGED_TEXT', () => {
  test('is the one line the workspace shows', () => {
    expect(OWNER_MANAGED_TEXT).toBe('This agent is managed by the Owner.');
  });
});
