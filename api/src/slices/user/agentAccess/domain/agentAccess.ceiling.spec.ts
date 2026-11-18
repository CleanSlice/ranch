import {
  ADMIN,
  OWNER,
  USER,
  accessHarness,
  person,
} from './__fixtures__/agentAccess';
import { AgentAccessError } from './agentAccess.types';

/**
 * The ceiling (CLEAN-231, research R8): whatever an Admin does to a User's
 * access, the User never ends up reaching an agent the Admin does not reach
 * and the User did not reach before. Checked where the change is applied,
 * over outcomes, so it holds for any request and any kind of edit.
 *
 * Throughout: agents A, B, C; the Admin is limited to A and B.
 */

function limitedAdmin() {
  const h = accessHarness();
  h.gateway.seed(ADMIN.id, true, [
    { agentId: 'A', list: 'allowed' },
    { agentId: 'B', list: 'allowed' },
  ]);
  return h;
}

const refusal = async (run: Promise<unknown>): Promise<string> => {
  try {
    await run;
  } catch (e) {
    if (e instanceof AgentAccessError) return e.code;
    throw e;
  }
  return 'saved';
};

const admin = person(ADMIN);
const owner = person(OWNER);

describe('the ceiling', () => {
  it('shows an Admin only the entries about agents the Admin reaches', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'C', list: 'allowed' },
    ]);
    const view = await service.view(admin, USER.id);
    expect(view.allowed).toEqual(['A']);
    expect(view.denied).toEqual([]);
    // The count is of what the Admin sees; that there is more is said, not shown.
    expect(view.outcome).toEqual({ kind: 'only', count: 1 });
    expect(view.hasEntriesOutsideView).toBe(true);
    expect(JSON.stringify(view)).not.toContain('"C"');

    // The Owner sees all of it.
    const whole = await service.view(owner, USER.id);
    expect(whole.allowed.sort()).toEqual(['A', 'C']);
    expect(whole.hasEntriesOutsideView).toBe(false);
  });

  it('a User with empty lists reaches agents the Admin does not: said, without names', async () => {
    const { service } = limitedAdmin();
    const view = await service.view(admin, USER.id);
    expect(view).toMatchObject({
      allowed: [],
      denied: [],
      outcome: { kind: 'all', count: 0 },
      hasEntriesOutsideView: true,
    });
  });

  it('lets the Admin add an agent they reach', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const { view } = await service.replace(admin, USER.id, {
      allowed: ['A', 'B'],
      denied: [],
    });
    expect(view.allowed.sort()).toEqual(['A', 'B']);
    expect(await service.reaches(person(USER), 'B')).toBe(true);
    expect(await service.reaches(person(USER), 'C')).toBe(false);
  });

  it('refuses to empty the allowed list: that would open agents the Admin does not have', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);

    let caught: unknown;
    try {
      await service.replace(
        admin,
        USER.id,
        { allowed: [], denied: [] },
        { confirmOpen: true },
      );
    } catch (e) {
      caught = e;
    }
    expect((caught as AgentAccessError).code).toBe('ACCESS_EXCEEDS_CEILING');
    // A sentence the person can act on (FR-018).
    expect((caught as AgentAccessError).message).toBe(
      'This would open agents you do not have. Ask the Owner.',
    );
    expect(await service.reaches(person(USER), 'C')).toBe(false);
    expect(await service.reaches(person(USER), 'A')).toBe(true);
  });

  it('the ceiling is refused before the confirmation is asked for', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    expect(
      await refusal(
        service.replace(admin, USER.id, { allowed: [], denied: [] }),
      ),
    ).toBe('ACCESS_EXCEEDS_CEILING');
  });

  it('lets the Admin deny and un-deny inside their own reach', async () => {
    const { service } = limitedAdmin();
    // The User starts open: reaches A, B and C.
    await service.replace(admin, USER.id, { allowed: [], denied: ['A'] });
    expect(await service.reaches(person(USER), 'A')).toBe(false);
    expect(await service.reaches(person(USER), 'C')).toBe(true);
    // Removing that denial opens A, which the Admin has.
    await service.replace(admin, USER.id, { allowed: [], denied: [] });
    expect(await service.reaches(person(USER), 'A')).toBe(true);
  });

  it('refuses a request that names an agent outside the view as an unknown agent, in full', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    for (const desired of [
      { allowed: ['A', 'C'], denied: [] },
      { allowed: ['A'], denied: ['C'] },
      { allowed: ['A', 'B', 'does-not-exist'], denied: [] },
    ]) {
      expect(await refusal(service.replace(admin, USER.id, desired))).toBe(
        'AGENT_NOT_FOUND',
      );
    }
    // Nothing of the refused requests was saved: B was never added.
    expect(await service.reaches(person(USER), 'B')).toBe(false);
    // The same through the moves of the assistant, `clear` included.
    for (const delta of [{ allow: ['C'] }, { deny: ['C'] }, { clear: ['C'] }]) {
      expect(await refusal(service.adjust(admin, USER.id, delta))).toBe(
        'AGENT_NOT_FOUND',
      );
    }
  });

  it('carries entries outside the view over unchanged', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'C', list: 'allowed' },
    ]);
    // The Admin sends its whole view, which cannot mention C.
    await service.replace(admin, USER.id, { allowed: ['B'], denied: ['A'] });
    const stored = (await gateway.load(USER.id)).entries.sort((x, y) =>
      x.agentId.localeCompare(y.agentId),
    );
    expect(stored).toEqual([
      { agentId: 'A', list: 'denied' },
      { agentId: 'B', list: 'allowed' },
      { agentId: 'C', list: 'allowed' },
    ]);

    // Emptying the Admin's part leaves the account limited to C: no ceiling
    // is broken, and nothing opens.
    const { view } = await service.replace(admin, USER.id, {
      allowed: [],
      denied: [],
    });
    expect(view.outcome).toEqual({ kind: 'only', count: 0 });
    expect(await service.reaches(person(USER), 'C')).toBe(true);
    expect(await service.reaches(person(USER), 'A')).toBe(false);

    // A denial about C survives the same way.
    gateway.seed(USER.id, false, [{ agentId: 'C', list: 'denied' }]);
    await service.replace(admin, USER.id, { allowed: [], denied: ['A'] });
    expect(await service.reaches(person(USER), 'C')).toBe(false);
  });

  it('an Admin whose own lists are empty is never refused on ceiling grounds', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const { view } = await service.replace(
      admin,
      USER.id,
      { allowed: [], denied: [] },
      { confirmOpen: true },
    );
    expect(view.outcome.kind).toBe('all');
    expect(view.hasEntriesOutsideView).toBe(false);
  });

  it('the Owner is not bound by it', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    await service.replace(
      owner,
      USER.id,
      { allowed: [], denied: [] },
      { confirmOpen: true },
    );
    expect(await service.reaches(person(USER), 'C')).toBe(true);
  });

  it('narrowing an Admin afterwards does not reach back to the Users they served', async () => {
    const { service, gateway } = limitedAdmin();
    await service.replace(admin, USER.id, { allowed: ['A', 'B'], denied: [] });
    gateway.seed(ADMIN.id, true, [{ agentId: 'A', list: 'allowed' }]);
    expect(await service.reaches(person(USER), 'B')).toBe(true);
    // From now on B is outside the Admin's view: kept, not shown, not nameable.
    const view = await service.view(admin, USER.id);
    expect(view.allowed).toEqual(['A']);
    expect(view.hasEntriesOutsideView).toBe(true);
  });

  it('two simultaneous edits end as one of them, never a merge', async () => {
    const { service, gateway } = limitedAdmin();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const version = (await service.view(owner, USER.id)).version;

    const results = await Promise.all([
      refusal(
        service.replace(
          owner,
          USER.id,
          { allowed: ['A'], denied: ['B'] },
          { version },
        ),
      ),
      refusal(
        service.replace(
          admin,
          USER.id,
          { allowed: ['B'], denied: ['A'] },
          { version },
        ),
      ),
    ]);
    expect(results.sort()).toEqual(['ACCESS_CHANGED', 'saved']);

    const { entries } = await gateway.load(USER.id);
    const ids = entries.map((e) => e.agentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('without a version two edits of one account still run one after the other', async () => {
    const { service, gateway } = limitedAdmin();
    // Limited to C throughout, so no move below opens the account.
    gateway.seed(USER.id, true, [{ agentId: 'C', list: 'allowed' }]);
    await Promise.all([
      service.adjust(owner, USER.id, { allow: ['A'] }),
      service.adjust(owner, USER.id, { deny: ['A'] }),
      service.adjust(owner, USER.id, { allow: ['B'] }),
    ]);
    const { entries } = await gateway.load(USER.id);
    expect(entries.filter((e) => e.agentId === 'A')).toHaveLength(1);
    expect(entries.find((e) => e.agentId === 'B')).toEqual({
      agentId: 'B',
      list: 'allowed',
    });
  });
});
