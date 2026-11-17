import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import { MCP_TOOL_METADATA_KEY, toolAudienceOf } from '#/mcp/decorators';
import type { ToolMetadata } from '#/mcp/decorators';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { audienceAllows, setCallerManagesAgents } from '#/mcp/tooling';
import { UserRoleTypes } from '#/user/user/domain';
import { RancherTool } from './rancher.tool';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  CoreV1Api: class {},
  CustomObjectsApi: class {},
  Log: class {},
  Watch: class {},
}));

/**
 * The agent tools of `RancherTool` after CLEAN-232: `create_agent` records
 * who created the agent, `restart_agent` and `update_agent` ask who may
 * manage the agent they name, and making an agent the Ranch admin agent is
 * the Owner's decision.
 */

const AGENTS = [
  { id: 'agent-1', name: 'Support', isAdmin: false, createdById: null },
  { id: 'agent-ranch', name: 'Ranch', isAdmin: true, createdById: null },
  { id: 'agent-mine', name: 'Mine', isAdmin: false, createdById: 'user-u' },
];

/** The Ranch admin agent's own token: Owner, whoever it is talking to. */
const ranch = (): Request =>
  ({
    user: { sub: 'agent:agent-ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;

const forItself = () => asTrustedAgent(ranch());
const forOwner = () => asPerson(ranch(), UserRoleTypes.Owner, 'user-o');
const forAdmin = () => asPerson(ranch(), UserRoleTypes.Admin, 'user-a');
/** A User who created `agent-mine`; the handler notes that they manage one. */
const forCreator = () => {
  const req = asPerson(ranch(), UserRoleTypes.User, 'user-u');
  setCallerManagesAgents(req, true);
  return req;
};
const forOtherUser = () => asPerson(ranch(), UserRoleTypes.User, 'user-x');

function harness() {
  const agents = {
    findById: jest.fn((id: string) =>
      Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
    ),
    update: jest.fn((id: string, data: object) =>
      Promise.resolve({ ...AGENTS.find((a) => a.id === id), ...data }),
    ),
    setAdmin: jest.fn((id: string, enabled: boolean) =>
      Promise.resolve({ id, isAdmin: enabled }),
    ),
  };
  const agentDeploy = {
    createAgent: jest.fn(
      (
        data: { name: string; createdById?: string | null },
        _opts: { isAdmin?: boolean },
      ) => Promise.resolve({ id: 'agent-new', ...data }),
    ),
    restartAgent: jest.fn(() => Promise.resolve()),
  };
  const templates = {
    findById: jest.fn(() => Promise.resolve({ id: 'tpl-1' })),
  };
  const stub = {} as never;
  const tool = new RancherTool(
    agents as never,
    agentDeploy as never,
    templates as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    permissionOver(agents),
  );
  return { tool, agents, agentDeploy, templates };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;
const NEW_AGENT = { name: 'Knox', templateId: 'tpl-1' };

/** A tool method as the registry reads it: off the prototype, never bound. */
const methodOf = (name: keyof RancherTool): unknown =>
  Object.getOwnPropertyDescriptor(RancherTool.prototype, name)?.value;
const audienceOf = (name: keyof RancherTool) =>
  toolAudienceOf(RancherTool, methodOf(name));
/** The argument names a tool accepts. */
const argumentsOf = (name: keyof RancherTool): string[] => {
  const metadata = Reflect.getMetadata(
    MCP_TOOL_METADATA_KEY,
    methodOf(name) as object,
  ) as ToolMetadata;
  return Object.keys(
    (metadata.parameters as unknown as { shape: Record<string, unknown> })
      .shape,
  ).sort();
};

describe('create_agent — who created the agent', () => {
  it('records the person the call is made for', async () => {
    const { tool, agentDeploy } = harness();

    await tool.createAgent(NEW_AGENT, null, forAdmin());

    expect(agentDeploy.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Knox', createdById: 'user-a' }),
      { isAdmin: undefined },
    );
  });

  it('records nobody for a trusted party: the agent on its own schedule', async () => {
    const { tool, agentDeploy } = harness();

    await tool.createAgent(NEW_AGENT, null, forItself());

    expect(agentDeploy.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: null }),
      { isAdmin: undefined },
    );
  });

  it('never the agent’s own subject', async () => {
    const { tool, agentDeploy } = harness();

    await tool.createAgent(NEW_AGENT, null, forOwner());
    await tool.createAgent(NEW_AGENT, null, forItself());

    expect(
      agentDeploy.createAgent.mock.calls.map(([data]) => data.createdById),
    ).toEqual(['user-o', null]);
  });

  it('is not for a User or a guest, whatever the agent’s token carries', async () => {
    const { tool, agentDeploy } = harness();

    await expect(
      tool.createAgent(NEW_AGENT, null, forOtherUser()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.createAgent(NEW_AGENT, null, asGuest(ranch())),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(agentDeploy.createAgent).not.toHaveBeenCalled();
  });

  it('takes no creator from the arguments', () => {
    expect(argumentsOf('createAgent')).toEqual([
      'isAdmin',
      'knowledgeIds',
      'llmCredentialId',
      'name',
      'templateId',
    ]);
  });
});

describe('the Ranch admin agent is the Owner’s decision', () => {
  it('create_agent with isAdmin is refused for an Admin, before anything is created', async () => {
    const { tool, agentDeploy, templates } = harness();

    const result = await tool.createAgent(
      { ...NEW_AGENT, isAdmin: true },
      null,
      forAdmin(),
    );

    expect(textOf(result)).toContain(
      'Only the Owner can make an agent the Ranch admin agent',
    );
    expect(agentDeploy.createAgent).not.toHaveBeenCalled();
    expect(templates.findById).not.toHaveBeenCalled();
  });

  it('and carried out for the Owner, and for the agent acting for itself', async () => {
    const { tool, agentDeploy } = harness();

    await tool.createAgent({ ...NEW_AGENT, isAdmin: true }, null, forOwner());
    await tool.createAgent({ ...NEW_AGENT, isAdmin: true }, null, forItself());

    expect(agentDeploy.createAgent.mock.calls.map(([, opts]) => opts)).toEqual([
      { isAdmin: true },
      { isAdmin: true },
    ]);
  });

  it('set_agent_admin is an owner tool: refused for an Admin', async () => {
    const { tool, agents } = harness();
    const audience = audienceOf('setAgentAdmin');

    expect(audience).toBe('owner');
    expect(audienceAllows(audience, forAdmin())).toBe(false);
    expect(audienceAllows(audience, forOwner())).toBe(true);
    await expect(
      tool.setAgentAdmin({ id: 'agent-1', enabled: true }, null, forAdmin()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(agents.setAdmin).not.toHaveBeenCalled();

    await tool.setAgentAdmin(
      { id: 'agent-1', enabled: true },
      null,
      forOwner(),
    );
    expect(agents.setAdmin).toHaveBeenCalledWith('agent-1', true);
  });
});

describe('restart_agent and update_agent — for an agent the caller may manage', () => {
  it('are manage-agent tools; the rest of the class stays admin', () => {
    expect(audienceOf('restartAgent')).toBe('manage-agent');
    expect(audienceOf('updateAgent')).toBe('manage-agent');
    expect(audienceOf('createAgent')).toBe('admin');
    expect(audienceOf('getAgent')).toBe('admin');
    expect(audienceOf('listAgents')).toBe('admin');
  });

  it('an Admin restarts and updates an ordinary agent', async () => {
    const { tool, agentDeploy, agents } = harness();

    await tool.restartAgent({ id: 'agent-1' }, null, forAdmin());
    await tool.updateAgent(
      { id: 'agent-1', name: 'Renamed' },
      null,
      forAdmin(),
    );

    expect(agentDeploy.restartAgent).toHaveBeenCalledWith('agent-1');
    expect(agents.update).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ name: 'Renamed' }),
    );
  });

  it('an Admin is told the Ranch admin agent is not found, as for an id that does not exist', async () => {
    const { tool, agentDeploy, agents } = harness();

    const answers = [
      await tool.restartAgent({ id: 'agent-ranch' }, null, forAdmin()),
      await tool.updateAgent(
        { id: 'agent-ranch', name: 'Mine now' },
        null,
        forAdmin(),
      ),
    ];
    const unknown = [
      await tool.restartAgent({ id: 'agent-nope' }, null, forAdmin()),
      await tool.updateAgent({ id: 'agent-nope', name: 'x' }, null, forAdmin()),
    ];

    expect(answers.map(textOf)).toEqual(
      unknown.map((r) => textOf(r).replace(/agent-nope/g, 'agent-ranch')),
    );
    expect(textOf(answers[0])).toContain('Agent agent-ranch not found');
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });

  it('the Owner manages the Ranch admin agent, and so does the agent for itself', async () => {
    const { tool, agentDeploy } = harness();

    await tool.restartAgent({ id: 'agent-ranch' }, null, forOwner());
    await tool.restartAgent({ id: 'agent-ranch' }, null, forItself());

    expect(agentDeploy.restartAgent).toHaveBeenCalledTimes(2);
  });

  it('a User manages the agent they created, and no other', async () => {
    const { tool, agentDeploy, agents } = harness();

    expect(audienceAllows('manage-agent', forCreator())).toBe(true);
    await tool.restartAgent({ id: 'agent-mine' }, null, forCreator());
    await tool.updateAgent(
      { id: 'agent-mine', name: 'Still mine' },
      null,
      forCreator(),
    );
    expect(agentDeploy.restartAgent).toHaveBeenCalledWith('agent-mine');
    expect(agents.update).toHaveBeenCalledTimes(1);

    expect(
      textOf(await tool.restartAgent({ id: 'agent-1' }, null, forCreator())),
    ).toContain('Agent agent-1 not found');
    expect(
      textOf(
        await tool.restartAgent({ id: 'agent-mine' }, null, forOtherUser()),
      ),
    ).toContain('Agent agent-mine not found');
    expect(agentDeploy.restartAgent).toHaveBeenCalledTimes(1);
  });

  it('a guest manages nothing, and the agent is not even looked up', async () => {
    const { tool, agents, agentDeploy } = harness();

    expect(
      textOf(
        await tool.restartAgent({ id: 'agent-1' }, null, asGuest(ranch())),
      ),
    ).toContain('Agent agent-1 not found');
    expect(agents.findById).not.toHaveBeenCalled();
    expect(agentDeploy.restartAgent).not.toHaveBeenCalled();
  });

  it('update_agent has no way to change who created an agent', async () => {
    const { tool, agents } = harness();
    expect(argumentsOf('updateAgent')).toEqual([
      'id',
      'knowledgeIds',
      'llmCredentialId',
      'name',
    ]);

    await tool.updateAgent(
      { id: 'agent-mine', name: 'x', createdById: 'user-x' } as never,
      null,
      forOwner(),
    );
    const [, data] = agents.update.mock.calls[0];
    expect(data).not.toHaveProperty('createdById');
  });
});
