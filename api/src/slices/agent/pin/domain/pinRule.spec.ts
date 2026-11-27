import { assistantIsAlwaysFirst, isPinnedFor } from './pinRule';

describe('pinRule (CLEAN-269)', () => {
  const pinned = new Set(['agent-a', 'agent-ranch']);

  it('an agent is pinned when the person pinned it', () => {
    expect(isPinnedFor({ id: 'agent-a', isAdmin: false }, pinned)).toBe(true);
    expect(isPinnedFor({ id: 'agent-b', isAdmin: false }, pinned)).toBe(false);
  });

  it('the Ranch assistant is never pinned, also for a person who pinned it', () => {
    expect(isPinnedFor({ id: 'agent-ranch', isAdmin: true }, pinned)).toBe(
      false,
    );
  });

  it('says in one sentence why, by the name of the assistant', () => {
    expect(assistantIsAlwaysFirst(' Rancher ')).toBe(
      'Rancher is the Ranch assistant: it is always first in every agent list, so it is not pinned. Nothing was changed.',
    );
    expect(assistantIsAlwaysFirst('')).toMatch(/^This agent is the Ranch/);
  });
});
