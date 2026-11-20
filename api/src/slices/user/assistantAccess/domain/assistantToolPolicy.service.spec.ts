import type { Request } from 'express';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import { AssistantToolPolicyService } from './assistantToolPolicy.service';
import type { AssistantAccessService } from './assistantAccess.service';
import { abilityOf } from './assistantLevels';

const ABILITIES = [
  ['list_agents', 'agents', 'read', 'reader'],
  ['restart_agent', 'agents', 'write', 'manage-agent'],
  ['create_user', 'users_keys', 'write', 'admin'],
  ['get_my_assistant_access', 'users_keys', 'read', 'person'],
  ['query_knowledge', 'knowledge', 'read', 'everyone'],
  ['ask_agent', 'peers', 'write', 'agent'],
].map(([name, topic, effect, audience]) =>
  abilityOf({
    metadata: { name, title: name, topic, effect } as never,
    audience: audience as never,
  }),
);

/** A request carrying an agent's own token. */
const fromAgent = (agentId: string): Request =>
  ({
    user: { sub: `agent:${agentId}`, email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;

/** A person calling the MCP endpoint with their own console token. */
const fromConsole = (userId: string, role: UserRoleTypes): Request =>
  ({ user: { sub: userId, email: '', roles: [role] } }) as unknown as Request;

function harness(
  grant: { enabled: boolean; names: string[] | null } = {
    enabled: true,
    names: ['list_agents'],
  },
  assistant: { id: string; name: string } | null = {
    id: 'assistant',
    name: 'Rancher',
  },
) {
  const access = {
    assistant: jest.fn(async () => assistant),
    abilities: jest.fn(() => ABILITIES),
    grantFor: jest.fn(async () => ({
      enabled: grant.enabled,
      names: grant.names === null ? null : new Set(grant.names),
      level: 'basic',
    })),
  };
  const policy = new AssistantToolPolicyService(
    access as unknown as AssistantAccessService,
  );
  return { policy, access };
}

const sorted = (set: Set<string> | null) => (set ? [...set].sort() : null);

describe('AssistantToolPolicyService', () => {
  it('narrows a person talking through the assistant to what they were given', async () => {
    const { policy, access } = harness();
    const req = asPerson(
      fromAgent('assistant'),
      UserRoleTypes.Admin,
      'admin-1',
    );

    expect(sorted(await policy.allowedToolsFor(req))).toEqual([
      // What the assistant needs to talk at all is never taken away…
      'ask_agent',
      // …nor the one tool that tells the person what they have.
      'get_my_assistant_access',
      'list_agents',
      'query_knowledge',
    ]);
    expect(access.grantFor).toHaveBeenCalledWith({
      kind: 'person',
      userId: 'admin-1',
      role: UserRoleTypes.Admin,
    });
  });

  it('with the assistant off nothing governed is left', async () => {
    const { policy } = harness({ enabled: false, names: ['list_agents'] });
    const req = asPerson(fromAgent('assistant'), UserRoleTypes.User, 'user-1');
    expect(sorted(await policy.allowedToolsFor(req))).toEqual([
      'ask_agent',
      'query_knowledge',
    ]);
  });

  it.each([
    [
      'the Owner',
      () => asPerson(fromAgent('assistant'), UserRoleTypes.Owner, 'owner'),
    ],
    [
      'the assistant acting for itself',
      () => asTrustedAgent(fromAgent('assistant')),
    ],
    ['a guest of the assistant', () => asGuest(fromAgent('assistant'))],
  ])('has no opinion about %s', async (_label, make) => {
    const { policy } = harness({ enabled: true, names: null });
    expect(await policy.allowedToolsFor(make())).toBeNull();
  });

  it('has no opinion about another agent, whoever it is answering', async () => {
    const { policy, access } = harness();
    const req = asPerson(
      fromAgent('support-bot'),
      UserRoleTypes.User,
      'user-1',
    );
    expect(await policy.allowedToolsFor(req)).toBeNull();
    expect(access.grantFor).not.toHaveBeenCalled();
  });

  // Their console power is their own; the assistant's settings are about
  // what the assistant does for them.
  it('has no opinion about a person calling with their own console token', async () => {
    const { policy, access } = harness();
    expect(
      await policy.allowedToolsFor(fromConsole('admin-1', UserRoleTypes.Admin)),
    ).toBeNull();
    expect(access.assistant).not.toHaveBeenCalled();
  });

  it('has no opinion while the installation has no assistant', async () => {
    const { policy } = harness(undefined, null);
    const req = asPerson(
      fromAgent('assistant'),
      UserRoleTypes.Admin,
      'admin-1',
    );
    expect(await policy.allowedToolsFor(req)).toBeNull();
  });

  it('asks once per request', async () => {
    const { policy, access } = harness();
    const req = asPerson(
      fromAgent('assistant'),
      UserRoleTypes.Admin,
      'admin-1',
    );
    await Promise.all([
      policy.allowedToolsFor(req),
      policy.allowedToolsFor(req),
    ]);
    expect(access.grantFor).toHaveBeenCalledTimes(1);
  });
});
