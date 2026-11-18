import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { audienceAllows, type ToolResult } from '#/mcp/tooling';
import { toolAudienceOf } from '#/mcp/decorators';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentAccessTool, outcomeSentence } from './agentAccess.tool';
import {
  ADMIN,
  OWNER,
  USER,
  accessHarness,
  usersGateway,
} from './domain/__fixtures__/agentAccess';

/**
 * Agent access from the chat (CLEAN-231): the same service as the routes,
 * so the same rules and the same sentences. What is the tools' own: who is
 * listed them, the dry run before a yes, and names next to ids.
 */

const NAMES: Record<string, string> = {
  A: 'alpha',
  B: 'bravo',
  C: 'charlie-secret',
};

const agents = {
  findAll: () =>
    Promise.resolve(Object.entries(NAMES).map(([id, name]) => ({ id, name }))),
} as unknown as IAgentGateway;

/** The Ranch admin agent's request: its token carries Owner. */
const ranchRequest = (): Request =>
  ({
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;

const forPerson = (p: { id: string; role: UserRoleTypes }) =>
  asPerson(ranchRequest(), p.role, p.id);

function harness() {
  const h = accessHarness();
  const tool = new AgentAccessTool(h.service, usersGateway(), agents);
  return { ...h, tool };
}

const textOf = (result: ToolResult): string =>
  result.content.map((c) => c.text).join('\n');
const dataOf = <T>(result: ToolResult): T => JSON.parse(textOf(result)) as T;

describe('AgentAccessTool: who has it', () => {
  it('audience admin on both tools', () => {
    for (const method of [
      'getUserAgentAccess',
      'setUserAgentAccess',
    ] as const) {
      expect(
        toolAudienceOf(AgentAccessTool, AgentAccessTool.prototype[method]),
      ).toBe('admin');
    }
  });

  it('listed for the Owner, an Admin and the trusted agent; not for a User or a guest', async () => {
    const { tool } = harness();
    const listed = (req: Request) =>
      tool
        .isListedForRequest(req)
        .then((own) => own && audienceAllows('admin', req));
    expect(await listed(forPerson(OWNER))).toBe(true);
    expect(await listed(forPerson(ADMIN))).toBe(true);
    expect(await listed(asTrustedAgent(ranchRequest()))).toBe(true);
    expect(await listed(forPerson(USER))).toBe(false);
    expect(await listed(asGuest(ranchRequest()))).toBe(false);
  });

  it('the body refuses a User and a guest too, whatever was listed', async () => {
    const { tool } = harness();
    for (const req of [forPerson(USER), asGuest(ranchRequest())]) {
      await expect(
        tool.getUserAgentAccess({ userId: USER.id }, null, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        tool.setUserAgentAccess(
          { userId: USER.id, deny: ['A'], confirm: true },
          null,
          req,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('get_user_agent_access', () => {
  it('shows the lists with names and the outcome as a sentence', async () => {
    const { tool, gateway } = harness();
    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'B', list: 'denied' },
    ]);
    const result = await tool.getUserAgentAccess(
      { userId: USER.id },
      null,
      forPerson(OWNER),
    );
    expect(result.isError).toBeUndefined();
    expect(dataOf(result)).toMatchObject({
      userId: USER.id,
      allowed: [{ id: 'A', name: 'alpha' }],
      denied: [{ id: 'B', name: 'bravo' }],
      outcome: { kind: 'only', count: 1 },
      sentence: 'Reaches only these 1',
      needsReview: false,
      hasEntriesOutsideView: false,
    });
  });

  it('an Admin is shown only agents they reach: neither the id nor the name of another', async () => {
    const { tool, gateway } = harness();
    gateway.seed(ADMIN.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'B', list: 'allowed' },
    ]);
    gateway.seed(USER.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'C', list: 'allowed' },
    ]);
    const text = textOf(
      await tool.getUserAgentAccess(
        { userId: USER.id },
        null,
        forPerson(ADMIN),
      ),
    );
    expect(text).toContain('alpha');
    expect(text).not.toContain('charlie-secret');
    expect(text).not.toContain('"C"');
    expect(
      dataOf<{ hasEntriesOutsideView: boolean }>({
        content: [{ type: 'text', text }],
      }).hasEntriesOutsideView,
    ).toBe(true);
  });

  it('refuses, in the route’s sentence, an account the caller may not read', async () => {
    const { tool } = harness();
    const result = await tool.getUserAgentAccess(
      { userId: OWNER.id },
      null,
      forPerson(ADMIN),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('The Owner reaches every agent');
  });

  it('an unknown user names the next move', async () => {
    const { tool } = harness();
    const result = await tool.getUserAgentAccess(
      { userId: 'user-x' },
      null,
      forPerson(OWNER),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'User user-x not found — call list_users to find the id',
    );
  });
});

describe('set_user_agent_access', () => {
  it('without confirm changes nothing and states what the access would be', async () => {
    const { tool, service } = harness();
    const result = await tool.setUserAgentAccess(
      { userId: USER.id, allow: ['A'] },
      null,
      forPerson(OWNER),
    );
    const data = dataOf<{
      changed: boolean;
      wouldBe: { sentence: string; allowed: unknown[] };
      message: string;
    }>(result);
    expect(data.changed).toBe(false);
    expect(data.wouldBe.sentence).toBe('Reaches only these 1');
    expect(data.wouldBe.allowed).toEqual([{ id: 'A', name: 'alpha' }]);
    expect(data.message).toContain('confirm: true');
    // Nothing was saved.
    expect(
      (await service.view({ kind: 'trusted' }, USER.id)).version,
    ).toBeNull();
  });

  it('with confirm applies the moves: allow, deny and clear', async () => {
    const { tool, service } = harness();
    const owner = forPerson(OWNER);
    await tool.setUserAgentAccess(
      { userId: USER.id, allow: ['A', 'B'], confirm: true },
      null,
      owner,
    );
    const moved = dataOf<{
      changed: boolean;
      access: { allowed: { id: string }[]; denied: { id: string }[] };
    }>(
      await tool.setUserAgentAccess(
        { userId: USER.id, deny: ['A'], confirm: true },
        null,
        owner,
      ),
    );
    expect(moved.changed).toBe(true);
    // A moved from allowed to denied: on one list only.
    expect(moved.access.allowed.map((a) => a.id)).toEqual(['B']);
    expect(moved.access.denied.map((a) => a.id)).toEqual(['A']);

    await tool.setUserAgentAccess(
      { userId: USER.id, clear: ['A'], confirm: true },
      null,
      owner,
    );
    const view = await service.view({ kind: 'trusted' }, USER.id);
    expect(view.allowed).toEqual(['B']);
    expect(view.denied).toEqual([]);
  });

  it('warns in the dry run when the change opens the account, and the yes covers it', async () => {
    const { tool, gateway, service } = harness();
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const owner = forPerson(OWNER);
    const dry = dataOf<{ changed: boolean; warning?: string }>(
      await tool.setUserAgentAccess(
        { userId: USER.id, clear: ['A'] },
        null,
        owner,
      ),
    );
    expect(dry.changed).toBe(false);
    expect(dry.warning).toBe(
      'This account will reach every agent that is not denied.',
    );
    await tool.setUserAgentAccess(
      { userId: USER.id, clear: ['A'], confirm: true },
      null,
      owner,
    );
    expect((await service.outcome(USER.id)).kind).toBe('all');
  });

  it('an Admin meets the ceiling exactly as in the console, dry run included', async () => {
    const { tool, gateway, service } = harness();
    gateway.seed(ADMIN.id, true, [
      { agentId: 'A', list: 'allowed' },
      { agentId: 'B', list: 'allowed' },
    ]);
    gateway.seed(USER.id, true, [{ agentId: 'A', list: 'allowed' }]);
    const admin = forPerson(ADMIN);

    for (const confirm of [undefined, true]) {
      const result = await tool.setUserAgentAccess(
        { userId: USER.id, clear: ['A'], confirm },
        null,
        admin,
      );
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'This would open agents you do not have. Ask the Owner.',
      );
    }
    // An agent outside the Admin's view is an unknown agent, by any move.
    const outside = await tool.setUserAgentAccess(
      { userId: USER.id, allow: ['C'], confirm: true },
      null,
      admin,
    );
    expect(outside.isError).toBe(true);
    expect(textOf(outside)).toBe(
      'Agent not found — call list_agents to find the id',
    );
    expect(
      await service.reaches({ userId: USER.id, role: USER.role }, 'C'),
    ).toBe(false);
  });

  it('nobody changes the Owner’s access or their own, the trusted agent included', async () => {
    const { tool } = harness();
    const onOwner = await tool.setUserAgentAccess(
      { userId: OWNER.id, deny: ['A'], confirm: true },
      null,
      asTrustedAgent(ranchRequest()),
    );
    expect(onOwner.isError).toBe(true);
    const onSelf = await tool.setUserAgentAccess(
      { userId: ADMIN.id, deny: ['A'], confirm: true },
      null,
      forPerson(ADMIN),
    );
    expect(onSelf.isError).toBe(true);
    expect(textOf(onSelf)).toContain('your own agent access');
  });

  it('an agent named twice across the moves is refused', async () => {
    const { tool } = harness();
    const result = await tool.setUserAgentAccess(
      { userId: USER.id, allow: ['A'], deny: ['A'], confirm: true },
      null,
      forPerson(OWNER),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('both allowed and denied');
  });

  it('results carry ids, names and sentences, never a credential-shaped field', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.setUserAgentAccess(
        { userId: USER.id, allow: ['A'], confirm: true },
        null,
        forPerson(OWNER),
      ),
    );
    for (const key of ['password', 'token', 'apiKey', 'secret']) {
      expect(text.toLowerCase()).not.toContain(key.toLowerCase());
    }
  });
});

describe('outcomeSentence', () => {
  it('is the four sentences of the data model', () => {
    expect(outcomeSentence({ kind: 'all', count: 0 })).toBe(
      'Reaches every agent',
    );
    expect(outcomeSentence({ kind: 'all_except', count: 2 })).toBe(
      'Reaches every agent except 2',
    );
    expect(outcomeSentence({ kind: 'only', count: 3 })).toBe(
      'Reaches only these 3',
    );
    expect(outcomeSentence({ kind: 'none', count: 0 })).toBe(
      'Reaches no agents — needs review',
    );
  });
});
