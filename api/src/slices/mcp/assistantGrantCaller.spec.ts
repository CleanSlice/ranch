/**
 * The per-call facts behind "an agent ability the assistant setting gave a
 * person" (CLEAN-254), as `#/mcp/tooling` reads them. The MCP handler notes
 * two things on a call's view: the `manage-agent` tools the setting holds
 * for the person, and the tool the call runs. Everything a tool then asks
 * (`audienceAllows`, `manageCaller`, a class's listing hook) is answered
 * from those and from the token, never from the party alone.
 */
import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { asGuest, asPeer, asPerson, asTrustedAgent } from './testing';
import {
  audienceAllows,
  callerGrantedTool,
  callerHoldsManageTools,
  callerManagesAgents,
  manageCaller,
  managesByGrantOnly,
  operatorOnly,
  setCalledTool,
  setCallerAssistantGrant,
  setCallerManagesAgents,
  setCallerParty,
  withCallerParty,
} from './tooling';

/** The assistant's runtime: the Ranch admin agent, its token carries Owner. */
const assistantToken = (): Request =>
  ({
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;

const plainAgentToken = (): Request =>
  ({
    user: { sub: 'agent:support', email: '', roles: ['agent'] },
  }) as unknown as Request;

const consoleToken = (role: UserRoleTypes): Request =>
  ({ user: { sub: 'user-1', email: '', roles: [role] } }) as unknown as Request;

/** A User behind the assistant whose setting holds `names`. */
const granted = (names: string[], called?: string): Request => {
  const req = asPerson(assistantToken(), UserRoleTypes.User);
  setCallerAssistantGrant(req, names);
  if (called) setCalledTool(req, called);
  return req;
};

const USER: ICallerParty = {
  kind: 'person',
  userId: 'user-1',
  role: UserRoleTypes.User,
};

describe('audienceAllows: a manage-agent tool the setting holds', () => {
  it('admits the person for that tool, by name, and for no other', () => {
    const req = granted(['restart_agent']);
    expect(audienceAllows('manage-agent', req, 'restart_agent')).toBe(true);
    expect(audienceAllows('manage-agent', req, 'delete_agent')).toBe(false);
  });

  it('asked without a name, only managing an agent counts', () => {
    const req = granted(['restart_agent']);
    expect(audienceAllows('manage-agent', req)).toBe(false);
    expect(callerManagesAgents(req)).toBe(false);
  });

  it('opens no other audience, whatever name is noted', () => {
    const req = granted(['create_user', 'set_user_role', 'restart_agent']);
    expect(audienceAllows('admin', req, 'create_user')).toBe(false);
    expect(audienceAllows('owner', req, 'set_user_role')).toBe(false);
    expect(audienceAllows('agent', req, 'restart_agent')).toBe(true);
    expect(audienceAllows('person', req, 'restart_agent')).toBe(true);
  });

  it('nothing noted is nothing granted', () => {
    const req = asPerson(assistantToken(), UserRoleTypes.User);
    expect(audienceAllows('manage-agent', req, 'restart_agent')).toBe(false);
    expect(callerGrantedTool(req, 'restart_agent')).toBe(false);
    expect(callerGrantedTool(granted([]), 'restart_agent')).toBe(false);
    expect(callerGrantedTool(granted(['restart_agent']), '')).toBe(false);
    expect(callerGrantedTool(granted(['restart_agent']), undefined)).toBe(
      false,
    );
  });

  it('is bounded by the token: a plain agent naming the same person has nothing', () => {
    const req = asPerson(plainAgentToken(), UserRoleTypes.User);
    setCallerAssistantGrant(req, ['restart_agent']);
    setCalledTool(req, 'restart_agent');
    expect(audienceAllows('manage-agent', req, 'restart_agent')).toBe(false);
    expect(callerHoldsManageTools(req)).toBe(false);
    expect(manageCaller(req)).toEqual({ kind: 'guest' });
  });

  it('a person’s own console token carries no such grant, even if one were noted', () => {
    const req = consoleToken(UserRoleTypes.User);
    setCallerAssistantGrant(req, ['restart_agent']);
    setCalledTool(req, 'restart_agent');
    expect(audienceAllows('manage-agent', req, 'restart_agent')).toBe(false);
    expect(callerHoldsManageTools(req)).toBe(false);
    expect(manageCaller(req)).toEqual(USER);
  });

  it('nor a guest, a colleague’s question or the agent acting for itself', () => {
    for (const mark of [asGuest, asPeer, asTrustedAgent]) {
      const req = mark(assistantToken());
      setCallerAssistantGrant(req, ['restart_agent']);
      setCalledTool(req, 'restart_agent');
      expect(callerGrantedTool(req, 'restart_agent')).toBe(false);
      expect(manageCaller(req)).not.toHaveProperty('grantedThroughAssistant');
    }
  });
});

describe('manageCaller: the grant is about the tool this call runs', () => {
  it('marks the person when the called tool is one the setting holds', () => {
    expect(manageCaller(granted(['restart_agent'], 'restart_agent'))).toEqual({
      ...USER,
      grantedThroughAssistant: true,
    });
  });

  it('does not mark them for another tool, held or not', () => {
    expect(manageCaller(granted(['restart_agent'], 'delete_agent'))).toEqual(
      USER,
    );
    // `get_agent` is not a manage-agent tool: the handler never notes it,
    // so running it makes nobody a manager.
    expect(manageCaller(granted(['restart_agent'], 'get_agent'))).toEqual(USER);
  });

  it('does not mark them while no tool is being called (a listing)', () => {
    expect(manageCaller(granted(['restart_agent']))).toEqual(USER);
  });

  it('drops a mark the party arrived with', () => {
    const req = assistantToken();
    setCallerParty(req, { ...USER, grantedThroughAssistant: true });
    expect(manageCaller(req)).toEqual(USER);
    setCalledTool(req, 'restart_agent');
    expect(manageCaller(req)).toEqual(USER);
  });

  it('leaves an operator as they are', () => {
    const req = asPerson(assistantToken(), UserRoleTypes.Admin, 'admin-1');
    setCalledTool(req, 'restart_agent');
    expect(manageCaller(req)).toEqual({
      kind: 'person',
      userId: 'admin-1',
      role: UserRoleTypes.Admin,
    });
  });

  it('one view per call: a grant noted for one call is not on the next', () => {
    const shared = assistantToken();
    const first = withCallerParty(shared, USER);
    setCallerAssistantGrant(first, ['restart_agent']);
    setCalledTool(first, 'restart_agent');
    const second = withCallerParty(shared, USER);
    setCalledTool(second, 'restart_agent');

    expect(manageCaller(first)).toHaveProperty('grantedThroughAssistant', true);
    expect(manageCaller(second)).toEqual(USER);
    expect(manageCaller(shared)).toEqual({ kind: 'guest' });
  });
});

describe('callerHoldsManageTools: what a manage-agent class answers its listing hook', () => {
  it('yes for whoever manages an agent, as before', () => {
    expect(
      callerHoldsManageTools(asPerson(assistantToken(), UserRoleTypes.Admin)),
    ).toBe(true);
    expect(callerHoldsManageTools(asTrustedAgent(assistantToken()))).toBe(true);
    const creator = asPerson(assistantToken(), UserRoleTypes.User);
    setCallerManagesAgents(creator, true);
    expect(callerHoldsManageTools(creator)).toBe(true);
  });

  it('yes for a person the setting gave at least one such tool', () => {
    expect(callerHoldsManageTools(granted(['restart_agent']))).toBe(true);
  });

  it('no for a person it gave none, and for a guest', () => {
    expect(callerHoldsManageTools(granted([]))).toBe(false);
    expect(
      callerHoldsManageTools(asPerson(assistantToken(), UserRoleTypes.User)),
    ).toBe(false);
    expect(callerHoldsManageTools(asGuest(assistantToken()))).toBe(false);
  });
});

describe('managesByGrantOnly / operatorOnly: a grant is not an operator’s power', () => {
  const agent = { createdById: 'user-maker' };

  it('true for a person below Admin who did not make the agent', () => {
    const req = granted(['update_agent'], 'update_agent');
    expect(managesByGrantOnly(req, agent)).toBe(true);
    expect(managesByGrantOnly(req, { createdById: null })).toBe(true);
    expect(managesByGrantOnly(req, {})).toBe(true);
  });

  it('false for whoever manages by role, and for the agent acting for itself', () => {
    for (const role of [UserRoleTypes.Admin, UserRoleTypes.Owner]) {
      expect(managesByGrantOnly(asPerson(assistantToken(), role), agent)).toBe(
        false,
      );
      expect(managesByGrantOnly(consoleToken(role), agent)).toBe(false);
    }
    expect(managesByGrantOnly(asTrustedAgent(assistantToken()), agent)).toBe(
      false,
    );
  });

  it('false for the person who made the agent: theirs by the creator line', () => {
    const maker = asPerson(assistantToken(), UserRoleTypes.User, 'user-maker');
    expect(managesByGrantOnly(maker, agent)).toBe(false);
    expect(managesByGrantOnly(maker, { createdById: 'someone-else' })).toBe(
      true,
    );
    // An empty id on either side is no creator at all.
    expect(managesByGrantOnly(maker, { createdById: '' })).toBe(true);
  });

  it('operatorOnly refuses such a person, naming the part, and nobody else', () => {
    const refusal = operatorOnly(
      granted(['update_agent'], 'update_agent'),
      agent,
      'Changing the model credential of an agent (llmCredentialId)',
    );
    expect(refusal?.isError).toBe(true);
    expect(refusal?.content[0].text).toBe(
      'Changing the model credential of an agent (llmCredentialId) is for ' +
        'an Owner or Admin, and is not part of what was included for this ' +
        'account. Nothing was done. Say so to the person in one sentence; ' +
        'do not try it another way.',
    );
    expect(
      operatorOnly(asPerson(assistantToken(), UserRoleTypes.Admin), agent, 'x'),
    ).toBeNull();
    expect(
      operatorOnly(asTrustedAgent(assistantToken()), agent, 'x'),
    ).toBeNull();
  });
});
