import { NotFoundException } from '@nestjs/common';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import {
  ADMIN,
  OWNER,
  USER,
  USER2,
  accessHarness,
  person,
} from './__fixtures__/agentAccess';
import { refuseAccessEdit, summarize } from './agentAccess.service';
import {
  AgentAccessError,
  AgentAccessErrorCodes,
  AgentReach,
} from './agentAccess.types';

/**
 * The access rule (CLEAN-231, data-model.md):
 *
 *   reaches(caller, agent) =
 *       true    if the caller is not a person with role Admin or User
 *       false   if the agent is on the caller's denied list
 *       false   if limited and the agent is not on the allowed list
 *       true    otherwise
 */

const refusal = async (run: Promise<unknown>): Promise<string> => {
  try {
    await run;
  } catch (e) {
    if (e instanceof AgentAccessError) return e.code;
    throw e;
  }
  return 'saved';
};

describe('AgentAccessService: who reaches what', () => {
  it('an account nobody edited reaches every agent, a new one included', async () => {
    const { service, gateway } = accessHarness();
    expect(await service.reaches(person(USER), 'A')).toBe(true);
    gateway.agents.add('NEW');
    expect(await service.reaches(person(USER), 'NEW')).toBe(true);
  });

  it('a denied agent is not reached, everything else is', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, false, [{ agentId: 'A', list: 'denied' }]);
    expect(await service.reaches(person(USER), 'A')).toBe(false);
    expect(await service.reaches(person(USER), 'B')).toBe(true);
    expect(await service.reaches(person(USER), 'NEW')).toBe(true);
  });

  it('a limited account reaches only its allowed agents', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'B', list: 'allowed' },
    ]);
    expect(await service.reaches(person(USER), 'A')).toBe(true);
    expect(await service.reaches(person(USER), 'C')).toBe(false);
    expect(await service.reaches(person(USER), 'NEW')).toBe(false);
  });

  it('a denial wins while the account is limited, and is kept for later', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'B', list: 'denied' },
    ]);
    expect(await service.reaches(person(USER), 'B')).toBe(false);
    expect(await service.reaches(person(USER), 'C')).toBe(false);
  });

  it('never restricts the Owner, a trusted agent, a guest or nobody', async () => {
    const { service, gateway } = accessHarness();
    // Lists left over from before the account became the Owner: ignored.
    gateway.seed(OWNER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    expect(await service.reaches(person(OWNER), 'C')).toBe(true);
    expect(await service.reaches({ kind: 'trusted' }, 'C')).toBe(true);
    expect(await service.reaches({ kind: 'guest' }, 'C')).toBe(true);
    expect(await service.reaches(null, 'C')).toBe(true);
    expect(await service.reaches(undefined, 'C')).toBe(true);
    // An agent runtime is no person, whatever id it carries.
    expect(
      await service.reaches(
        { userId: USER.id, role: UserRoleTypes.Agent },
        'C',
      ),
    ).toBe(true);
  });

  it('applies to an Admin exactly as to a User', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(ADMIN.id, true, [{ agentId: 'A', list: 'allowed' }]);
    expect(await service.reaches(person(ADMIN), 'A')).toBe(true);
    expect(await service.reaches(person(ADMIN), 'C')).toBe(false);
  });

  it('reads the lists on every call: a change applies to the next question', async () => {
    const { service, gateway } = accessHarness();
    expect(await service.reaches(person(USER), 'A')).toBe(true);
    gateway.seed(USER.id, false, [{ agentId: 'A', list: 'denied' }]);
    expect(await service.reaches(person(USER), 'A')).toBe(false);
  });

  it('assertReaches answers the route’s own not found, and nothing for a reached agent', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, false, [{ agentId: 'A', list: 'denied' }]);
    await expect(
      service.assertReaches(person(USER), 'B'),
    ).resolves.toBeUndefined();
    await expect(service.assertReaches(person(USER), 'A')).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
    await expect(
      service.assertReaches(person(USER), 'A', 'Chat c-1 not found'),
    ).rejects.toThrow(new NotFoundException('Chat c-1 not found'));
    // A record that names no agent hides none.
    await expect(
      service.assertReaches(person(USER), null),
    ).resolves.toBeUndefined();
  });

  it('reachableIds filters a list and turns into a database filter', async () => {
    const { service, gateway } = accessHarness();
    const rows = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const idOf = (r: { id: string }) => r.id;

    const open = await service.reachableIds(person(USER));
    expect(open.unrestricted).toBe(true);
    expect(open.where()).toBeUndefined();
    expect(open.filter(rows, idOf)).toEqual(rows);

    gateway.seed(USER.id, false, [{ agentId: 'B', list: 'denied' }]);
    const except = await service.reachableIds(person(USER));
    expect(except.filter(rows, idOf)).toEqual([{ id: 'A' }, { id: 'C' }]);
    expect(except.where()).toEqual({ notIn: ['B'] });

    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'C', list: 'allowed' },
      { agentId: 'B', list: 'denied' },
    ]);
    const only = await service.reachableIds(person(USER));
    expect(only.filter(rows, idOf)).toEqual([{ id: 'A' }, { id: 'C' }]);
    expect(only.where()).toEqual({ in: ['A', 'C'] });

    expect(AgentReach.ALL.has('anything')).toBe(true);
  });
});

describe('AgentAccessService: what the lists come to', () => {
  it('the four outcomes', () => {
    expect(summarize(null)).toEqual({ kind: 'all', needsReview: false });
    expect(
      summarize({
        limited: false,
        entries: [{ agentId: 'A', list: 'denied' }],
      }),
    ).toEqual({ kind: 'all_except', needsReview: false });
    expect(
      summarize({
        limited: true,
        entries: [{ agentId: 'A', list: 'allowed' }],
      }),
    ).toEqual({ kind: 'only', needsReview: false });
    expect(summarize({ limited: true, entries: [] })).toEqual({
      kind: 'none',
      needsReview: true,
    });
  });

  it('the Owner is always `all` on the user list, whatever rows exist', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(OWNER.id, true, []);
    gateway.seed(USER.id, false, [{ agentId: 'A', list: 'denied' }]);
    const marks = await service.summaries([OWNER, USER, USER2]);
    expect(marks.get(OWNER.id)).toEqual({ kind: 'all', needsReview: false });
    expect(marks.get(USER.id)).toEqual({
      kind: 'all_except',
      needsReview: false,
    });
    expect(marks.get(USER2.id)).toEqual({ kind: 'all', needsReview: false });
  });

  it('deleting the only allowed agent leaves no access and a review mark, never everything', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    gateway.deleteAgent('A');

    expect(await service.outcome(USER.id)).toEqual({
      kind: 'none',
      needsReview: true,
    });
    for (const id of ['B', 'C']) {
      expect(await service.reaches(person(USER), id)).toBe(false);
    }
    // Adding an allowed agent ends the review.
    await service.replace(person(OWNER), USER.id, {
      allowed: ['B'],
      denied: [],
    });
    expect(await service.outcome(USER.id)).toEqual({
      kind: 'only',
      needsReview: false,
    });
  });

  it('a deleted agent on a denied list just goes', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, false, [{ agentId: 'A', list: 'denied' }]);
    gateway.deleteAgent('A');
    expect(await service.outcome(USER.id)).toEqual({
      kind: 'all',
      needsReview: false,
    });
  });
});

describe('AgentAccessService.replace as the Owner', () => {
  it('who may edit whom agrees with the account rule', () => {
    const owner = person(OWNER);
    const admin = person(ADMIN);
    const user = person(USER);
    const E = AgentAccessErrorCodes;
    void E;
    expect(refuseAccessEdit(owner, ADMIN)).toBeNull();
    expect(refuseAccessEdit(owner, USER)).toBeNull();
    expect(refuseAccessEdit(owner, OWNER)).not.toBeNull();
    expect(refuseAccessEdit(admin, USER)).toBeNull();
    expect(refuseAccessEdit(admin, ADMIN)).not.toBeNull();
    expect(
      refuseAccessEdit(admin, { id: 'user-admin2', role: UserRoleTypes.Admin }),
    ).not.toBeNull();
    expect(refuseAccessEdit(admin, OWNER)).not.toBeNull();
    expect(refuseAccessEdit(user, USER2)).not.toBeNull();
    expect(refuseAccessEdit(user, USER)).not.toBeNull();
    // A trusted party acts as the Owner, and the Owner account has no lists.
    expect(refuseAccessEdit({ kind: 'trusted' }, ADMIN)).toBeNull();
    expect(refuseAccessEdit({ kind: 'trusted' }, OWNER)).not.toBeNull();
  });

  it('refuses the Owner’s account, the editor’s own, and an unknown user', async () => {
    const { service } = accessHarness();
    const none = { allowed: [], denied: [] };
    expect(await refusal(service.replace(person(OWNER), OWNER.id, none))).toBe(
      'ACCESS_NOT_EDITABLE',
    );
    expect(await refusal(service.replace(person(ADMIN), ADMIN.id, none))).toBe(
      'ACCESS_NOT_EDITABLE',
    );
    expect(await refusal(service.replace(person(OWNER), 'nobody', none))).toBe(
      'USER_NOT_FOUND',
    );
  });

  it('saves both lists and says what they come to', async () => {
    const { service } = accessHarness();
    const { view, saved } = await service.replace(person(OWNER), USER.id, {
      allowed: ['A', 'B'],
      denied: ['C'],
    });
    expect(saved).toBe(true);
    expect(view).toMatchObject({
      userId: USER.id,
      allowed: ['A', 'B'],
      denied: ['C'],
      outcome: { kind: 'only', count: 2 },
      needsReview: false,
      hasEntriesOutsideView: false,
    });
    expect(typeof view.version).toBe('string');
  });

  it('an agent in both arrays is refused, and nothing is saved', async () => {
    const { service } = accessHarness();
    expect(
      await refusal(
        service.replace(person(OWNER), USER.id, {
          allowed: ['A'],
          denied: ['A'],
        }),
      ),
    ).toBe('ACCESS_LISTS_OVERLAP');
    expect((await service.view(person(OWNER), USER.id)).version).toBeNull();
  });

  it('an unknown agent refuses the whole request', async () => {
    const { service } = accessHarness();
    expect(
      await refusal(
        service.replace(person(OWNER), USER.id, {
          allowed: ['A', 'nope'],
          denied: [],
        }),
      ),
    ).toBe('AGENT_NOT_FOUND');
    expect(await service.reaches(person(USER), 'C')).toBe(true);
  });

  it('moving an agent between lists never leaves it on both', async () => {
    const { service, gateway } = accessHarness();
    await service.replace(person(OWNER), USER.id, {
      allowed: ['A', 'B'],
      denied: [],
    });
    const moved = await service.replace(person(OWNER), USER.id, {
      allowed: ['B'],
      denied: ['A'],
    });
    expect(moved.view.allowed).toEqual(['B']);
    expect(moved.view.denied).toEqual(['A']);
    const stored = await gateway.load(USER.id);
    expect(stored.entries.filter((e) => e.agentId === 'A')).toEqual([
      { agentId: 'A', list: 'denied' },
    ]);

    const back = await service.adjust(person(OWNER), USER.id, { allow: ['A'] });
    expect(back.view.allowed.sort()).toEqual(['A', 'B']);
    expect(back.view.denied).toEqual([]);
  });

  it('turning a limited account into an open one needs a confirmation', async () => {
    const { service } = accessHarness();
    await service.replace(person(OWNER), USER.id, {
      allowed: ['A'],
      denied: ['B'],
    });
    const open = { allowed: [], denied: ['B'] };

    let caught: unknown;
    try {
      await service.replace(person(OWNER), USER.id, open);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentAccessError);
    expect((caught as AgentAccessError).code).toBe('ACCESS_OPEN_NEEDS_CONFIRM');
    // The refusal carries what the change would come to.
    expect((caught as AgentAccessError).outcome).toEqual({
      kind: 'all_except',
      count: 1,
    });
    expect(await service.reaches(person(USER), 'C')).toBe(false);

    const { view, opens } = await service.replace(
      person(OWNER),
      USER.id,
      open,
      { confirmOpen: true },
    );
    expect(opens).toBe(true);
    expect(view.outcome).toEqual({ kind: 'all_except', count: 1 });
    expect(await service.reaches(person(USER), 'C')).toBe(true);
  });

  it('an account under review opens only on a confirmed change too', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, true, []);
    const none = { allowed: [], denied: [] };
    expect(await refusal(service.replace(person(OWNER), USER.id, none))).toBe(
      'ACCESS_OPEN_NEEDS_CONFIRM',
    );
    await service.replace(person(OWNER), USER.id, none, { confirmOpen: true });
    expect(await service.outcome(USER.id)).toEqual({
      kind: 'all',
      needsReview: false,
    });
  });

  it('a stale version is refused; the current one, and null for a fresh account, pass', async () => {
    const { service } = accessHarness();
    const first = await service.replace(
      person(OWNER),
      USER.id,
      { allowed: [], denied: ['A'] },
      { version: null },
    );
    // Somebody else's editor still holds "never edited".
    expect(
      await refusal(
        service.replace(
          person(OWNER),
          USER.id,
          { allowed: [], denied: ['B'] },
          { version: null },
        ),
      ),
    ).toBe('ACCESS_CHANGED');
    const second = await service.replace(
      person(OWNER),
      USER.id,
      { allowed: [], denied: ['B'] },
      { version: first.view.version },
    );
    expect(second.view.denied).toEqual(['B']);
    expect(second.view.version).not.toBe(first.view.version);
  });

  it('a dry run validates and saves nothing', async () => {
    const { service } = accessHarness();
    const dry = await service.replace(
      person(OWNER),
      USER.id,
      { allowed: ['A'], denied: [] },
      { dryRun: true },
    );
    expect(dry.saved).toBe(false);
    expect(dry.view.outcome).toEqual({ kind: 'only', count: 1 });
    expect(await service.reaches(person(USER), 'B')).toBe(true);
  });

  it('tells its listeners after a saved change, and only then', async () => {
    const { service } = accessHarness();
    const seen: string[] = [];
    const stop = service.onChanged((userId) => seen.push(userId));

    await service.replace(person(OWNER), USER.id, {
      allowed: [],
      denied: ['A'],
    });
    // The same state again: nothing changed, nobody is told.
    await service.replace(person(OWNER), USER.id, {
      allowed: [],
      denied: ['A'],
    });
    await refusal(
      service.replace(person(OWNER), USER.id, { allowed: ['x'], denied: [] }),
    );
    expect(seen).toEqual([USER.id]);

    stop();
    await service.replace(person(OWNER), USER.id, { allowed: [], denied: [] });
    expect(seen).toEqual([USER.id]);
  });

  it('removeUser leaves no row and no entry behind', async () => {
    const { service, gateway } = accessHarness();
    await service.replace(person(OWNER), USER.id, {
      allowed: ['A'],
      denied: [],
    });
    await service.removeUser(USER.id);
    expect(await gateway.load(USER.id)).toEqual({
      userId: USER.id,
      limited: false,
      entries: [],
      updatedAt: null,
      // The account went with it: no lists, and nothing reached.
      accountMissing: true,
    });
  });
});

describe('AgentAccessService: a limited account that creates an agent', () => {
  it('gets the new agent on its allowed list', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(ADMIN.id, true, [{ agentId: 'A', list: 'allowed' }]);
    expect(await service.allowCreated({}, ADMIN.id, 'D')).toBe(true);
    expect(await service.reaches(person(ADMIN), 'D')).toBe(true);
    expect(await service.reaches(person(ADMIN), 'B')).toBe(false);
  });

  it('an open account gets no entry: it reaches the new agent anyway', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(ADMIN.id, false, [{ agentId: 'A', list: 'denied' }]);
    expect(await service.allowCreated({}, ADMIN.id, 'D')).toBe(false);
    expect((await gateway.load(ADMIN.id)).entries).toEqual([
      { agentId: 'A', list: 'denied' },
    ]);
    expect(await service.reaches(person(ADMIN), 'D')).toBe(true);
  });
});

/**
 * A token outlives its account: the bearer guard verifies the signature and
 * never reads the user row, so a deleted person's token is accepted until
 * it expires. Their access row is deleted with them, and no row used to read
 * as "not limited, no entries": a restricted person who was deleted reached
 * every agent for as long as the token lived. An account that does not
 * exist reaches nothing.
 */
describe('AgentAccessService: an account that no longer exists', () => {
  it('reaches nothing after it is removed, although its lists are gone', async () => {
    const { service, gateway } = accessHarness();
    gateway.seed(USER.id, false, [{ agentId: 'A', list: 'denied' }]);
    expect(await service.reaches(person(USER), 'B')).toBe(true);

    await service.removeUser(USER.id);

    for (const id of ['A', 'B', 'C']) {
      expect(await service.reaches(person(USER), id)).toBe(false);
      expect(await service.reachesExisting(person(USER), id)).toBe(false);
    }
    const reach = await service.reachableIds(person(USER));
    expect(reach.unrestricted).toBe(false);
    expect(reach.filter([{ id: 'A' }, { id: 'B' }], (r) => r.id)).toEqual([]);
    expect(reach.where()).toEqual({ in: [] });
    await expect(service.assertReaches(person(USER), 'B')).rejects.toThrow(
      new NotFoundException('Agent not found'),
    );
  });

  it('the same for an Admin, and the Owner is still not looked up', async () => {
    const { service } = accessHarness();
    await service.removeUser(ADMIN.id);
    expect(await service.reaches(person(ADMIN), 'A')).toBe(false);
    expect(await service.reaches(person(OWNER), 'A')).toBe(true);
  });

  it('a missing account is not an unedited one', () => {
    const missing = new AgentReach({
      limited: false,
      entries: [],
      accountMissing: true,
    });
    expect(missing.has('A')).toBe(false);
    expect(missing.unrestricted).toBe(false);
    expect(new AgentReach({ limited: false, entries: [] }).has('A')).toBe(true);
  });

  it('tells the removal listeners, not the change listeners, and even when the cleanup fails', async () => {
    const { service, gateway } = accessHarness();
    const changed: string[] = [];
    const removed: string[] = [];
    service.onChanged((id) => changed.push(id));
    const stop = service.onRemoved((id) => removed.push(id));

    await service.removeUser(USER.id);
    expect(removed).toEqual([USER.id]);
    expect(changed).toEqual([]);

    jest
      .spyOn(gateway, 'removeUser')
      .mockRejectedValueOnce(new Error('database is down'));
    await expect(service.removeUser(USER2.id)).rejects.toThrow(
      'database is down',
    );
    // A socket left open is worse than a row left behind.
    expect(removed).toEqual([USER.id, USER2.id]);

    stop();
    await service.removeUser(ADMIN.id);
    expect(removed).toEqual([USER.id, USER2.id]);
  });

  it('accountReachingExisting reads the account now: gone, limited, or the Owner', async () => {
    const { service, gateway } = accessHarness();
    const reach = (id: string, agentId: string) =>
      service.accountReachingExisting(id, agentId);
    expect(await reach(USER.id, 'A')).toEqual({ id: USER.id, role: USER.role });
    expect(await reach(USER.id, 'nope')).toBe(null);
    expect(await reach('nobody', 'A')).toBe(null);
    expect(await reach('', 'A')).toBe(null);
    gateway.seed(USER.id, true, [{ agentId: 'B', list: 'allowed' }]);
    expect(await reach(USER.id, 'A')).toBe(null);
    expect(await reach(USER.id, 'B')).toEqual({ id: USER.id, role: USER.role });
    // The role comes back as the database has it: it decides whose file a
    // browser import lands in (CLEAN-243).
    expect(await reach(OWNER.id, 'A')).toEqual({ id: OWNER.id, role: OWNER.role });
  });
});

// The assistant is not an entry in anybody's lists (CLEAN-240). Whether a
// person has it is a switch of its own, handed to this service; the lists
// neither grant nor take it.
describe('AgentAccessService: the assistant is set apart from the lists', () => {
  // 'R' is the assistant among the agents A, B, C.
  const withAssistant = (enabledFor: Record<string, boolean> = {}) => {
    const { gateway, service } = accessHarness(['A', 'B', 'C', 'R']);
    const asked: string[] = [];
    service.attachAssistant({
      assistantId: async () => 'R',
      forPerson: async ({ userId }) => {
        asked.push(userId);
        return { id: 'R', enabled: enabledFor[userId] ?? true };
      },
    });
    return { gateway, service, asked };
  };

  it('an account limited to other agents still reaches it', async () => {
    const { service } = withAssistant();
    await service.replace(person(OWNER), ADMIN.id, {
      allowed: ['A'],
      denied: [],
    });

    expect(await service.reaches(person(ADMIN), 'R')).toBe(true);
    expect(await service.reaches(person(ADMIN), 'A')).toBe(true);
    expect(await service.reaches(person(ADMIN), 'B')).toBe(false);
    expect(await service.reachesExisting(person(ADMIN), 'R')).toBe(true);
  });

  it('switched off, it is not reached whatever the lists say', async () => {
    const { service } = withAssistant({ [USER.id]: false });
    expect(await service.reaches(person(USER), 'R')).toBe(false);
    expect(await service.reachesExisting(person(USER), 'R')).toBe(false);
    expect(await service.reaches(person(USER), 'A')).toBe(true);
    await expect(
      service.assertReaches(person(USER), 'R'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the Owner and callers that are not people are never asked about', async () => {
    const { service, asked } = withAssistant({ [OWNER.id]: false });
    expect(await service.reaches(person(OWNER), 'R')).toBe(true);
    expect(await service.reaches({ kind: 'trusted' }, 'R')).toBe(true);
    expect(await service.reaches(null, 'R')).toBe(true);
    expect(asked).toEqual([]);
  });

  it('filters and scopes follow the switch, not the lists', async () => {
    const on = withAssistant();
    await on.service.replace(person(OWNER), ADMIN.id, {
      allowed: ['A'],
      denied: [],
    });
    const limited = await on.service.reachableIds(person(ADMIN));
    expect(limited.filter(['A', 'B', 'R'], (id) => id)).toEqual(['A', 'R']);
    expect(limited.where()).toEqual({ in: ['A', 'R'] });

    const off = withAssistant({ [USER.id]: false });
    const open = await off.service.reachableIds(person(USER));
    expect(open.unrestricted).toBe(false);
    expect(open.filter(['A', 'B', 'R'], (id) => id)).toEqual(['A', 'B']);
    expect(open.where()).toEqual({ notIn: ['R'] });

    await off.service.replace(person(OWNER), USER.id, {
      allowed: [],
      denied: ['B'],
    });
    expect((await off.service.reachableIds(person(USER))).where()).toEqual({
      notIn: ['B', 'R'],
    });
  });

  it('with it on and no lists the account is still unrestricted', async () => {
    const { service } = withAssistant();
    expect((await service.reachableIds(person(USER))).unrestricted).toBe(true);
    expect((await service.reachableIds(person(USER))).where()).toBeUndefined();
  });

  it('is not shown among the agents of an account’s lists', async () => {
    const { service } = withAssistant();
    await service.replace(person(OWNER), ADMIN.id, {
      allowed: ['A'],
      denied: ['B'],
    });
    const view = await service.view(person(OWNER), ADMIN.id);
    expect([...view.allowed, ...view.denied]).not.toContain('R');
    expect(view.outcome).toEqual({ kind: 'only', count: 1 });
  });

  it.each([
    ['allowed', { allowed: ['A', 'R'], denied: [] }],
    ['denied', { allowed: [], denied: ['R'] }],
  ])('cannot be put on the %s list', async (_list, desired) => {
    const { service, gateway } = withAssistant();
    expect(
      await refusal(service.replace(person(OWNER), ADMIN.id, desired)),
    ).toBe(AgentAccessErrorCodes.AssistantNotListed);
    expect((await gateway.load(ADMIN.id)).entries).toEqual([]);
  });

  it('an entry left from before it was set apart changes nothing', async () => {
    const { service, gateway } = withAssistant();
    await gateway.transaction(USER.id, (tx) =>
      tx.save({
        limited: false,
        entries: [{ agentId: 'R', list: 'denied' }],
        updatedById: null,
      }),
    );
    expect(await service.reaches(person(USER), 'R')).toBe(true);
  });

  it('without an assistant on the installation nothing changes', async () => {
    const { service } = accessHarness(['A', 'B']);
    service.attachAssistant({
      assistantId: async () => null,
      forPerson: async () => null,
    });
    await service.replace(person(OWNER), ADMIN.id, {
      allowed: ['A'],
      denied: [],
    });
    expect(await service.reaches(person(ADMIN), 'B')).toBe(false);
    expect((await service.reachableIds(person(ADMIN))).where()).toEqual({
      in: ['A'],
    });
  });
});

/**
 * CLEAN-236. A reach with some agents taken out, for a question narrower
 * than "may they use the agent": the conversations of an agent only the
 * Owner manages are not an Admin's to read because they may talk to it.
 */
describe('AgentReach.without', () => {
  const entries = (list: 'allowed' | 'denied', ...ids: string[]) =>
    ids.map((agentId) => ({ agentId, list }));

  it('takes agents out of a reach that hid nothing', () => {
    const reach = AgentReach.ALL.without(['R']);

    expect(reach.has('R')).toBe(false);
    expect(reach.has('A')).toBe(true);
    expect(reach.where()).toEqual({ notIn: ['R'] });
    // The reach it was made from is untouched.
    expect(AgentReach.ALL.has('R')).toBe(true);
  });

  it('adds to a denied list, and takes out of an allowed one', () => {
    const denied = new AgentReach({
      limited: false,
      entries: entries('denied', 'B'),
    }).without(['R']);
    expect(denied.where()).toEqual({ notIn: ['B', 'R'] });

    const allowed = new AgentReach({
      limited: true,
      entries: entries('allowed', 'A', 'R'),
    }).without(['R']);
    expect(allowed.where()).toEqual({ in: ['A'] });
    expect(allowed.has('R')).toBe(false);
    expect(allowed.has('A')).toBe(true);
    expect(allowed.has('Z')).toBe(false);
  });

  // CLEAN-240 meets CLEAN-236: the agent taken out is usually the assistant,
  // and the assistant is not in the lists but behind its own switch.
  it('takes the assistant out even when its switch is on, and keeps the switch otherwise', () => {
    const reach = new AgentReach(
      { limited: true, entries: [{ agentId: 'A', list: 'allowed' }] },
      { id: 'R', enabled: true },
    );
    expect(reach.has('R')).toBe(true);

    const withoutAssistant = reach.without(['R']);
    expect(withoutAssistant.has('R')).toBe(false);
    expect(withoutAssistant.has('A')).toBe(true);
    expect(withoutAssistant.where()).toEqual({ in: ['A'] });

    const withoutAnother = reach.without(['B']);
    expect(withoutAnother.has('R')).toBe(true);
    expect(withoutAnother.where()).toEqual({ in: ['A', 'R'] });
  });

  it('is the same reach when nothing is taken out', () => {
    const reach = new AgentReach({ limited: false, entries: [] });
    expect(reach.without([])).toBe(reach);
  });

  it('an account that reaches nothing still reaches nothing', () => {
    const none = new AgentReach({
      limited: true,
      entries: [],
      accountMissing: true,
    }).without(['R']);
    expect(none.has('A')).toBe(false);
    expect(none.where()).toEqual({ in: [] });
  });
});
