import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AgentAdminTool } from './agentAdmin.tool';
import type { IAgentData } from './domain';
import type { IAgentGateway } from './domain';
import type { AgentDeployService } from './domain/agentDeploy.service';
import type { AgentStatusService } from './domain/agentStatus.service';
import type { WorkflowService } from '#/workflow/domain/workflow.service';
import type { IPodGateway, IAgentPodStatus } from '#/agent/pod/domain';
import type { IFileGateway } from '#/agent/file/domain';
import type { AgentMcpResolver } from '#/mcpServer/domain/agentMcpResolver.service';
import type { IMcpServerData } from '#/mcpServer/domain/mcpServer.types';
import { UserRoleTypes } from '#/user/user/domain';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';
import { PERSON_REFUSAL, setCallerManagesAgents } from '#/mcp/tooling';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import type { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import {
  accessHarness,
  openAccess,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';

/**
 * These tools stop, start and delete agents from the chat. What matters most
 * is not the happy path but that a plain agent cannot reach them, that a
 * destructive call without the person's yes touches nothing, and that no
 * credential — env values, MCP auth — ever lands in a result a model reads.
 */
const agent = (overrides: Partial<IAgentData> = {}): IAgentData =>
  ({
    id: 'agent-a',
    name: 'Support Bot',
    templateId: 'tpl-1',
    llmCredentialId: 'llm-1',
    status: 'running',
    statusReason: null,
    workflowId: 'wf-1',
    firstDeployedAt: null,
    lastDeployStartedAt: new Date('2026-09-17T10:00:00.000Z'),
    launchContext: null,
    config: {},
    resources: {},
    isAdmin: false,
    debugEnabled: false,
    knowledgeIds: [],
    ...overrides,
  }) as unknown as IAgentData;

const pod = (overrides: Partial<IAgentPodStatus> = {}): IAgentPodStatus => ({
  agentId: 'agent-a',
  podName: 'agent-a-pod',
  phase: 'Running',
  ready: true,
  restartCount: 0,
  startedAt: '2026-09-17T10:00:00.000Z',
  terminating: false,
  lastTerminationReason: null,
  containerWaitingReason: null,
  message: null,
  observedAt: '2026-09-17T10:05:00.000Z',
  ...overrides,
});

const SECRET_URL = 'https://mcp.example/hidden-path';
const SECRET_AUTH = 'Bearer super-secret-mcp-token';

const server = (overrides: Partial<IMcpServerData> = {}): IMcpServerData => ({
  id: 'mcp-1',
  name: 'Docs',
  description: null,
  url: SECRET_URL,
  transport: 'streamable-http' as IMcpServerData['transport'],
  authType: 'bearer' as IMcpServerData['authType'],
  authValue: SECRET_AUTH,
  oauthClientId: null,
  enabled: true,
  builtIn: true,
  templateIds: [],
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

interface Harness {
  tool: AgentAdminTool;
  agents: { findById: jest.Mock; delete: jest.Mock; update: jest.Mock };
  deploy: { stopAgent: jest.Mock; deploy: jest.Mock };
  status: { getCapacity: jest.Mock };
  pods: { list: jest.Mock; getMetrics: jest.Mock; delete: jest.Mock };
  workflows: { previewAgentEnv: jest.Mock; cancelAgentWorkflow: jest.Mock };
  files: { wipe: jest.Mock };
  mcps: { resolveForAgent: jest.Mock };
  pins: { pin: jest.Mock; unpin: jest.Mock };
  toolState: { detail: jest.Mock };
}

// The access lists hide nothing unless a test hands in its own.
function harness(access: AgentAccessService = openAccess()): Harness {
  const agents = {
    findById: jest.fn().mockResolvedValue(agent()),
    delete: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(agent()),
  };
  const pins = {
    pin: jest.fn().mockResolvedValue(true),
    unpin: jest.fn().mockResolvedValue(true),
    pinnedIds: jest.fn().mockResolvedValue(new Set()),
    removeUser: jest.fn(),
  };
  const deploy = {
    stopAgent: jest.fn().mockResolvedValue(undefined),
    deploy: jest.fn().mockResolvedValue(undefined),
  };
  const status = {
    getCapacity: jest.fn().mockResolvedValue({
      freeAgentSlots: 3,
      usedAgentSlots: 5,
      totalAgentSlots: 8,
      slotCpuMilli: 100,
      slotMemBytes: 536870912,
      nodes: [],
      observedAt: '2026-09-17T10:05:00.000Z',
    }),
  };
  const pods = {
    list: jest.fn().mockResolvedValue([pod()]),
    getMetrics: jest.fn().mockResolvedValue({
      pod: {
        cpuMilli: 42,
        memBytes: 1024,
        cpuLimitMilli: 1000,
        memLimitBytes: 2048,
      },
      node: { name: 'node-1', diskAvailBytes: 10, diskCapacityBytes: 100 },
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const workflows = {
    previewAgentEnv: jest.fn().mockResolvedValue([
      { name: 'LOG_LEVEL', value: 'debug' },
      { name: 'LLM_API_KEY', value: 'sk-live-do-not-leak' },
      { name: 'TELEGRAM_BOT_TOKEN', value: 'tg-bot-token-value' },
      { name: 'OPTIONAL_SECRET', value: '' },
    ]),
    cancelAgentWorkflow: jest.fn().mockResolvedValue(undefined),
  };
  const files = { wipe: jest.fn().mockResolvedValue(7) };
  const mcps = { resolveForAgent: jest.fn().mockResolvedValue([server()]) };

  const toolState = { detail: jest.fn().mockReturnValue(null) };

  const tool = new AgentAdminTool(
    agents as unknown as IAgentGateway,
    deploy as unknown as AgentDeployService,
    status as unknown as AgentStatusService,
    pods as unknown as IPodGateway,
    workflows as unknown as WorkflowService,
    files as unknown as IFileGateway,
    mcps as unknown as AgentMcpResolver,
    permissionOver(agents),
    access,
    pins as unknown as IAgentPinGateway,
    toolState as never,
  );
  return {
    tool,
    agents,
    deploy,
    status,
    pods,
    workflows,
    files,
    mcps,
    pins,
    toolState,
  };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('AgentAdminTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('lists them for a signed-in person who manages nothing', async () => {
    // `pin_agent` is a `person` tool (CLEAN-231), so the class is listed for
    // any person; each tool's own audience still decides which of them.
    const { tool } = harness();
    const person = asPerson(
      request([UserRoleTypes.Owner]),
      UserRoleTypes.User,
      'user-1',
    );
    await expect(tool.isListedForRequest(person)).resolves.toBe(true);
    await expect(
      tool.isListedForRequest(asGuest(request([UserRoleTypes.Owner]))),
    ).resolves.toBe(false);
  });

  it('refuses a call from a plain agent even by name', async () => {
    // Answered like an agent that does not exist (CLEAN-232): no 403 that
    // would confirm the agent is there.
    const { tool, deploy, agents } = harness();
    const result = await tool.stopAgent(
      { id: 'agent-a', confirm: true },
      null,
      plainAgent(),
    );
    expect(textOf(result)).toContain(
      'Agent agent-a not found — there is no such agent for this caller',
    );
    // A plain agent has no `list_agents`, so the refusal does not name it.
    expect(textOf(result)).not.toContain('list_agents');
    expect(agents.findById).not.toHaveBeenCalled();
    expect(deploy.stopAgent).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.getClusterCapacity({}, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AgentAdminTool — stop_agent', () => {
  it('refuses without confirm and touches nothing', async () => {
    const { tool, deploy } = harness();
    const result = await tool.stopAgent(
      { id: 'agent-a', confirm: false },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('stop the agent «Support Bot»');
    expect(textOf(result)).toContain('confirm: true');
    expect(deploy.stopAgent).not.toHaveBeenCalled();
  });

  it('reports a missing agent before asking for confirmation', async () => {
    const { tool, agents, deploy } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.stopAgent(
      { id: 'nope', confirm: false },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('Agent nope not found');
    expect(textOf(result)).toContain('list_agents');
    expect(deploy.stopAgent).not.toHaveBeenCalled();
  });

  it('stops through the deploy service and hands back the fresh row', async () => {
    const { tool, agents, deploy } = harness();
    agents.findById
      .mockResolvedValueOnce(agent())
      .mockResolvedValueOnce(agent({ status: 'stopped', workflowId: null }));
    const text = textOf(
      await tool.stopAgent({ id: 'agent-a', confirm: true }, null, operator()),
    );
    expect(deploy.stopAgent).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"status": "stopped"');
    expect(text).toContain('start_agent');
  });
});

describe('AgentAdminTool — start_agent', () => {
  it('deploys a fresh pod', async () => {
    const { tool, agents, deploy } = harness();
    agents.findById
      .mockResolvedValueOnce(agent({ status: 'stopped' }))
      .mockResolvedValueOnce(agent({ status: 'deploying' }));
    const text = textOf(
      await tool.startAgent({ id: 'agent-a' }, null, operator()),
    );
    expect(deploy.deploy).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"status": "deploying"');
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, agents, deploy } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.startAgent({ id: 'nope' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_agents');
    expect(deploy.deploy).not.toHaveBeenCalled();
  });
});

describe('AgentAdminTool — pin_agent', () => {
  // Reversible and harmless, so no confirm step. A pin is personal
  // (CLEAN-231): what matters is that it is written for the person the call
  // is made for and nobody else, that the agent itself is not touched, that
  // the result carries only id / name / pinned, and that a caller who is not
  // a person, or who does not reach the agent, pins nothing.
  const user = () =>
    asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.User, 'user-1');

  it('pins for the person asking, whatever their role, and says so', async () => {
    const { tool, agents, pins } = harness();
    const text = textOf(
      await tool.pinAgent({ id: 'agent-a', pinned: true }, null, user()),
    );
    expect(pins.pin).toHaveBeenCalledWith('user-1', 'agent-a');
    expect(pins.unpin).not.toHaveBeenCalled();
    // The agent's own record is not what a pin changes.
    expect(agents.update).not.toHaveBeenCalled();
    expect(text).toContain('"pinned": true');
    expect(text).toContain(
      'Agent «Support Bot» is pinned for you — it stays at the top of your agent lists.',
    );
    // Only the three fields a model needs; no config, no credential id.
    expect(text).not.toContain('llmCredentialId');
    expect(text).not.toContain('"config"');
  });

  it('unpins with the same call', async () => {
    const { tool, agents, pins } = harness();
    const text = textOf(
      await tool.pinAgent({ id: 'agent-a', pinned: false }, null, user()),
    );
    expect(pins.unpin).toHaveBeenCalledWith('user-1', 'agent-a');
    expect(pins.pin).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
    expect(text).toContain('"pinned": false');
    expect(text).toContain(
      'Agent «Support Bot» is unpinned for you — back to its ordinary place in your lists.',
    );
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, agents, pins } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.pinAgent({ id: 'nope', pinned: true }, null, user()),
    );
    expect(text).toContain('Agent nope not found');
    expect(text).toContain('list_agents');
    expect(pins.pin).not.toHaveBeenCalled();
  });

  it('answers an agent the access lists hide like one that does not exist', async () => {
    const { gateway, service } = accessHarness(['agent-a']);
    gateway.seed('user-1', false, [{ agentId: 'agent-a', list: 'denied' }]);
    const hidden = harness(service);
    const missing = harness();
    missing.agents.findById.mockResolvedValue(null);

    const args = { id: 'agent-a', pinned: true };
    const text = textOf(await hidden.tool.pinAgent(args, null, user()));

    expect(text).toBe(textOf(await missing.tool.pinAgent(args, null, user())));
    expect(text).not.toContain('Support Bot');
    expect(hidden.pins.pin).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not a person and writes nothing', async () => {
    // An agent acting for itself has no lists to order, operator power or
    // not; neither has a guest.
    const { tool, agents, pins } = harness();
    for (const caller of [
      operator(),
      plainAgent(),
      asGuest(request([UserRoleTypes.Owner])),
    ]) {
      for (const pinned of [true, false]) {
        const err = await tool
          .pinAgent({ id: 'agent-a', pinned }, null, caller)
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toBe(PERSON_REFUSAL);
      }
    }
    expect(agents.findById).not.toHaveBeenCalled();
    expect(pins.pin).not.toHaveBeenCalled();
    expect(pins.unpin).not.toHaveBeenCalled();
    expect(agents.update).not.toHaveBeenCalled();
  });
});

describe('AgentAdminTool — delete_agent', () => {
  it('refuses without confirm and deletes nothing', async () => {
    const { tool, agents, pods, workflows, files } = harness();
    const result = await tool.deleteAgent(
      { id: 'agent-a', confirm: false },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('delete the agent «Support Bot»');
    expect(agents.delete).not.toHaveBeenCalled();
    expect(workflows.cancelAgentWorkflow).not.toHaveBeenCalled();
    expect(pods.delete).not.toHaveBeenCalled();
    expect(files.wipe).not.toHaveBeenCalled();
  });

  it('says the workspace will be wiped when wipeS3 is asked for', async () => {
    const { tool } = harness();
    const result = await tool.deleteAgent(
      { id: 'agent-a', wipeS3: true, confirm: false },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('wipe its workspace files');
  });

  it('removes the row, cancels the workflow and deletes the pod, keeping S3', async () => {
    const { tool, agents, pods, workflows, files } = harness();
    const text = textOf(
      await tool.deleteAgent(
        { id: 'agent-a', confirm: true },
        null,
        operator(),
      ),
    );
    expect(agents.delete).toHaveBeenCalledWith('agent-a');
    expect(workflows.cancelAgentWorkflow).toHaveBeenCalledWith('wf-1');
    expect(pods.delete).toHaveBeenCalledWith('agent-a');
    expect(files.wipe).not.toHaveBeenCalled();
    expect(text).toContain('"ok": true');
    expect(text).toContain('workspace files are kept');
  });

  it('wipes S3 only when wipeS3 is true', async () => {
    const { tool, files } = harness();
    const text = textOf(
      await tool.deleteAgent(
        { id: 'agent-a', wipeS3: true, confirm: true },
        null,
        operator(),
      ),
    );
    expect(files.wipe).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"wipedFiles": 7');
  });

  it('skips the workflow cancel when the agent has none', async () => {
    const { tool, agents, workflows } = harness();
    agents.findById.mockResolvedValue(agent({ workflowId: null }));
    await tool.deleteAgent({ id: 'agent-a', confirm: true }, null, operator());
    expect(workflows.cancelAgentWorkflow).not.toHaveBeenCalled();
  });

  it('tolerates a pod cleanup failure once the row is gone', async () => {
    const { tool, agents, pods } = harness();
    pods.delete.mockRejectedValue(new Error('k8s down'));
    const text = textOf(
      await tool.deleteAgent(
        { id: 'agent-a', confirm: true },
        null,
        operator(),
      ),
    );
    expect(agents.delete).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"ok": true');
  });

  it('reports a missing agent and deletes nothing', async () => {
    const { tool, agents } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.deleteAgent({ id: 'nope', confirm: true }, null, operator()),
    );
    expect(text).toContain('Agent nope not found');
    expect(agents.delete).not.toHaveBeenCalled();
  });
});

describe('AgentAdminTool — get_agent_status', () => {
  it('joins the row with its pod and metrics', async () => {
    const { tool, pods } = harness();
    const text = textOf(
      await tool.getAgentStatus({ id: 'agent-a' }, null, operator()),
    );
    expect(pods.getMetrics).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"status": "running"');
    expect(text).toContain('"phase": "Running"');
    expect(text).toContain('"ready": true');
    expect(text).toContain('"startedAt": "2026-09-17T10:00:00.000Z"');
    expect(text).toContain('"cpuMilli": 42');
    expect(text).toContain('"diskAvailBytes": 10');
  });

  it('returns null pod and metrics for an agent without a pod', async () => {
    const { tool, agents, pods } = harness();
    agents.findById.mockResolvedValue(
      agent({ status: 'stopped', statusReason: 'stopped by operator' }),
    );
    pods.list.mockResolvedValue([pod({ agentId: 'someone-else' })]);
    pods.getMetrics.mockResolvedValue(null);
    const text = textOf(
      await tool.getAgentStatus({ id: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"pod": null');
    expect(text).toContain('"metrics": null');
    expect(text).toContain('"statusReason": "stopped by operator"');
  });

  it('says how the tool servers stand, to who manages the agent (CLEAN-245)', async () => {
    const { tool, toolState } = harness();
    toolState.detail.mockReturnValue({
      phase: 'limited',
      since: '2026-11-20T09:10:52.000Z',
      servers: [
        {
          id: 'mcp-documents',
          name: 'Documents',
          state: 'retrying',
          since: '2026-11-20T09:09:53.000Z',
          attempts: 7,
          lastError: 'HTTP 503',
        },
      ],
    });
    const text = textOf(
      await tool.getAgentStatus({ id: 'agent-a' }, null, operator()),
    );
    expect(toolState.detail).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('"phase": "limited"');
    expect(text).toContain('"name": "Documents"');
    expect(text).toContain('"state": "retrying"');
    expect(text).toContain('"lastError": "HTTP 503"');
  });

  it('tools is null while no runtime has reported', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.getAgentStatus({ id: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"tools": null');
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, agents, pods } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.getAgentStatus({ id: 'nope' }, null, operator()),
    );
    expect(text).toContain('list_agents');
    expect(pods.getMetrics).not.toHaveBeenCalled();
  });
});

describe('AgentAdminTool — get_agent_env', () => {
  it('masks credential values by name and keeps the rest', async () => {
    const { tool, workflows } = harness();
    const text = textOf(
      await tool.getAgentEnv({ id: 'agent-a' }, null, operator()),
    );
    expect(workflows.previewAgentEnv).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-a' }),
    );
    expect(text).toContain('"name": "LOG_LEVEL"');
    expect(text).toContain('"value": "debug"');
    expect(text).toContain('"name": "LLM_API_KEY"');
    expect(text).toContain('••••');
    expect(text).not.toContain('sk-live-do-not-leak');
    expect(text).not.toContain('tg-bot-token-value');
  });

  it('leaves an unset secret empty rather than pretending it has a value', async () => {
    const { tool } = harness();
    const result = JSON.parse(
      textOf(await tool.getAgentEnv({ id: 'agent-a' }, null, operator())),
    ) as { name: string; value: string; masked: boolean }[];
    const unset = result.find((v) => v.name === 'OPTIONAL_SECRET');
    expect(unset).toEqual({
      name: 'OPTIONAL_SECRET',
      value: '',
      masked: false,
    });
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, agents, workflows } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.getAgentEnv({ id: 'nope' }, null, operator()),
    );
    expect(text).toContain('list_agents');
    expect(workflows.previewAgentEnv).not.toHaveBeenCalled();
  });
});

describe('AgentAdminTool — list_agent_mcps', () => {
  it('lists the servers without url or credential and reports no drift', async () => {
    const { tool, mcps } = harness();
    const text = textOf(
      await tool.listAgentMcps({ id: 'agent-a' }, null, operator()),
    );
    expect(mcps.resolveForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl-1' }),
    );
    expect(text).toContain('"name": "Docs"');
    expect(text).toContain('"builtIn": true');
    expect(text).toContain('"transport": "streamable-http"');
    expect(text).toContain('"restartRequired": false');
    expect(text).not.toContain(SECRET_AUTH);
    expect(text).not.toContain(SECRET_URL);
    expect(text).not.toContain('authValue');
    expect(text).not.toContain('"url"');
  });

  it('flags a restart when a server changed after the pod started', async () => {
    const { tool, mcps } = harness();
    mcps.resolveForAgent.mockResolvedValue([
      server({
        id: 'mcp-2',
        name: 'Jira',
        builtIn: false,
        updatedAt: new Date('2026-09-17T11:00:00.000Z'),
      }),
    ]);
    const text = textOf(
      await tool.listAgentMcps({ id: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"restartRequired": true');
    const parsed = JSON.parse(text) as {
      drift: { changedServers: string[]; configChangedAt: string | null };
    };
    expect(parsed.drift.changedServers).toEqual(['Jira']);
    expect(parsed.drift.configChangedAt).toBe('2026-09-17T11:00:00.000Z');
    expect(text).toContain('restart_agent with id=agent-a');
  });

  it('does not call a stopped agent stale', async () => {
    const { tool, pods, mcps } = harness();
    pods.list.mockResolvedValue([]);
    mcps.resolveForAgent.mockResolvedValue([
      server({ updatedAt: new Date('2026-09-17T11:00:00.000Z') }),
    ]);
    const text = textOf(
      await tool.listAgentMcps({ id: 'agent-a' }, null, operator()),
    );
    expect(text).toContain('"restartRequired": false');
    expect(text).toContain('No pod is running');
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, agents, mcps } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.listAgentMcps({ id: 'nope' }, null, operator()),
    );
    expect(text).toContain('list_agents');
    expect(mcps.resolveForAgent).not.toHaveBeenCalled();
  });
});

describe('AgentAdminTool — get_cluster_capacity', () => {
  it('hands back the capacity with a one-line summary', async () => {
    const { tool, status } = harness();
    const text = textOf(await tool.getClusterCapacity({}, null, operator()));
    expect(status.getCapacity).toHaveBeenCalled();
    expect(text).toContain('"freeAgentSlots": 3');
    expect(text).toContain('3 of 8 agent slot(s) free');
  });

  it('says the cluster is unreachable instead of inventing a number', async () => {
    const { tool, status } = harness();
    status.getCapacity.mockResolvedValue(null);
    const text = textOf(await tool.getClusterCapacity({}, null, operator()));
    expect(text).toContain('"capacity": null');
    expect(text).toContain('unreachable');
  });
});

// CLEAN-232: a refusal names the next move, and the next move must be one the
// caller has. A User manages the agents they created, so these tools are
// listed for them; `list_agents` is a `person` tool since CLEAN-231, so it is
// theirs as well and the refusal sends them there. What it must not do is
// tell an agent out of their reach from one that does not exist.
describe('AgentAdminTool — a refusal names only what the caller has', () => {
  const creator = () => {
    const req = asPerson(
      request([UserRoleTypes.Owner]),
      UserRoleTypes.User,
      'user-1',
    );
    setCallerManagesAgents(req, true);
    return req;
  };

  it('tells a User only that the id was not found, and where to look', async () => {
    const { tool, agents } = harness();
    // Somebody else's agent: out of reach, answered like one that is not there.
    agents.findById.mockResolvedValue(agent({ createdById: 'user-2' }));
    const results = [
      await tool.deleteAgent({ id: 'agent-a', confirm: true }, null, creator()),
      await tool.stopAgent({ id: 'agent-a', confirm: true }, null, creator()),
      await tool.startAgent({ id: 'agent-a' }, null, creator()),
    ];
    for (const result of results) {
      const text = textOf(result);
      // A person has `list_agents` and gets the agents they reach from it.
      expect(text).toContain(
        'Agent agent-a not found — call list_agents to find the id',
      );
      expect(text).not.toContain('Support Bot');
    }
    expect(agents.delete).not.toHaveBeenCalled();

    // An id nobody has reads the same.
    agents.findById.mockResolvedValue(null);
    expect(
      textOf(
        await tool.deleteAgent(
          { id: 'agent-a', confirm: true },
          null,
          creator(),
        ),
      ),
    ).toBe(textOf(results[0]));
  });

  it('still reaches the agent the User created', async () => {
    const { tool, agents } = harness();
    agents.findById.mockResolvedValue(agent({ createdById: 'user-1' }));
    const text = textOf(
      await tool.deleteAgent(
        { id: 'agent-a', confirm: false },
        null,
        creator(),
      ),
    );
    expect(text).toContain('delete the agent «Support Bot»');
    expect(text).not.toContain('not found');
  });

  it('keeps naming list_agents for an operator', async () => {
    const { tool, agents } = harness();
    agents.findById.mockResolvedValue(null);
    expect(
      textOf(
        await tool.deleteAgent({ id: 'nope', confirm: true }, null, operator()),
      ),
    ).toContain('Agent nope not found — call list_agents to find the id');
  });
});
