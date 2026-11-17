import type { Request } from 'express';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
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
 * `redeploy_skill_agents` restarts every agent whose template carries a
 * skill. Restarting an agent is managing it (CLEAN-232): the Ranch admin
 * agent is the Owner's, so an Admin redeploying a skill leaves it running
 * and is told how many agents were left, never which.
 */

const AGENTS = [
  { id: 'agent-1', name: 'Support', isAdmin: false, createdById: null },
  { id: 'agent-2', name: 'Sales', isAdmin: false, createdById: null },
  { id: 'agent-ranch', name: 'Ranch', isAdmin: true, createdById: null },
];

const ranch = (): Request =>
  ({
    user: { sub: 'agent:agent-ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;
const forItself = () => asTrustedAgent(ranch());
const forOwner = () => asPerson(ranch(), UserRoleTypes.Owner, 'user-o');
const forAdmin = () => asPerson(ranch(), UserRoleTypes.Admin, 'user-a');

function harness(using = AGENTS) {
  const agents = {
    findById: jest.fn((id: string) =>
      Promise.resolve(AGENTS.find((a) => a.id === id) ?? null),
    ),
  };
  const agentDeploy = { restartAgent: jest.fn(() => Promise.resolve()) };
  const skills = {
    findById: jest.fn(() =>
      Promise.resolve({ id: 'skill-1', title: 'Refunds' }),
    ),
    findDependentAgents: jest.fn(() =>
      Promise.resolve(
        using.map((a) => ({ id: a.id, name: a.name, templateName: 'tpl' })),
      ),
    ),
  };
  const stub = {} as never;
  const tool = new RancherTool(
    agents as never,
    agentDeploy as never,
    stub,
    stub,
    stub,
    skills as never,
    stub,
    stub,
    stub,
    stub,
    permissionOver(agents),
  );
  return { tool, agentDeploy };
}

const run = async (who: Request, using = AGENTS, confirm = true) => {
  const h = harness(using);
  const result = await h.tool.redeploySkillAgents(
    { skillId: 'skill-1', confirm },
    null,
    who as never,
  );
  const text = result.content[0].text;
  return {
    ...h,
    text,
    restarted: h.agentDeploy.restartAgent.mock.calls.flat(),
  };
};

describe('redeploy_skill_agents — agents the caller may not manage', () => {
  it('an Admin restarts the rest and is told how many were left, not which', async () => {
    const { restarted, text } = await run(forAdmin());

    expect([...restarted].sort()).toEqual(['agent-1', 'agent-2']);
    expect(JSON.parse(text)).toEqual({
      skillId: 'skill-1',
      total: 2,
      restarted: 2,
      failed: 0,
      skipped: 1,
      errors: [],
    });
    expect(text).not.toContain('agent-ranch');
  });

  it('asks an Admin to confirm the agents it will restart, not the one it will not', async () => {
    const { restarted, text } = await run(forAdmin(), AGENTS, false);

    expect(restarted).toEqual([]);
    expect(text).toContain('restart 2 agent(s)');
  });

  it('the Owner, and the Ranch admin agent for itself, restart all of them', async () => {
    expect((await run(forOwner())).restarted).toHaveLength(3);
    const itself = await run(forItself());
    expect(itself.restarted).toHaveLength(3);
    expect(JSON.parse(itself.text).skipped).toBe(0);
  });

  it('restarts nothing when the only agent is not the caller’s to manage', async () => {
    const { restarted, text } = await run(forAdmin(), [AGENTS[2]]);

    expect(restarted).toEqual([]);
    expect(JSON.parse(text)).toEqual({
      skillId: 'skill-1',
      total: 0,
      restarted: 0,
      failed: 0,
      skipped: 1,
      errors: [],
    });
  });
});
