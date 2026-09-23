import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { TemplateAdminTool } from './templateAdmin.tool';
import type { ITemplateData } from './domain';
import type { ITemplateGateway } from './domain';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { AgentDeployService } from '#/agent/agent/domain/agentDeploy.service';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Two of these tools take agents down (delete a template, restart every
 * agent on it), so the tests care most that a plain agent cannot reach them,
 * that nothing mutates before the person confirmed, and that every refusal
 * names what to do next.
 */
const templateRow = (
  overrides: Partial<ITemplateData> = {},
): ITemplateData => ({
  id: 'tpl-1',
  name: 'Support Template',
  description: 'Answers order questions.',
  image: 'ghcr.io/org/agent:latest',
  defaultConfig: {},
  defaultResources: { cpu: '500m', memory: '512Mi' },
  paddockConfig: {},
  defaultKnowledgeIds: [],
  sourceUrl: null,
  sourceType: null,
  manifestJson: null,
  version: null,
  skillIds: [],
  mcpServerIds: [],
  createdAt: new Date('2026-09-17T10:00:00.000Z'),
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: TemplateAdminTool;
  templates: {
    findById: jest.Mock;
    create: jest.Mock;
    setMcps: jest.Mock;
    countAgents: jest.Mock;
    delete: jest.Mock;
  };
  agents: { findByTemplateId: jest.Mock };
  deploy: { restartAgent: jest.Mock };
}

function harness(): Harness {
  const templates = {
    findById: jest.fn().mockResolvedValue(templateRow()),
    create: jest
      .fn()
      .mockImplementation(async (data) =>
        templateRow({ id: 'tpl-new', ...data }),
      ),
    setMcps: jest
      .fn()
      .mockImplementation(async (id, mcpServerIds) =>
        templateRow({ id, mcpServerIds }),
      ),
    countAgents: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const agents = {
    findByTemplateId: jest
      .fn()
      .mockResolvedValue([{ id: 'agent-a' }, { id: 'agent-b' }]),
  };
  const deploy = { restartAgent: jest.fn().mockResolvedValue(undefined) };

  const tool = new TemplateAdminTool(
    templates as unknown as ITemplateGateway,
    agents as unknown as IAgentGateway,
    deploy as unknown as AgentDeployService,
  );
  return { tool, templates, agents, deploy };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('TemplateAdminTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, templates } = harness();
    await expect(
      tool.createTemplate(
        { name: 'x', description: 'y', image: 'img' },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(templates.create).not.toHaveBeenCalled();
  });

  it('refuses a restart from a plain agent before touching any agent', async () => {
    const { tool, deploy } = harness();
    await expect(
      tool.restartTemplateAgents(
        { templateId: 'tpl-1', confirm: true },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deploy.restartAgent).not.toHaveBeenCalled();
  });
});

describe('create_template', () => {
  it('creates the template with exactly the fields given', async () => {
    const { tool, templates } = harness();
    const args = {
      name: 'Sales Template',
      description: 'Handles quotes.',
      image: 'ghcr.io/org/sales:1',
      defaultResources: { cpu: '1', memory: '1Gi' },
      defaultKnowledgeIds: ['kb-1'],
    };
    const text = textOf(await tool.createTemplate(args, null, operator()));
    expect(templates.create).toHaveBeenCalledWith(args);
    expect(text).toContain('"id": "tpl-new"');
    expect(text).toContain('Sales Template');
    expect(text).toContain('create_agent with templateId=tpl-new');
  });
});

describe('delete_template', () => {
  it('reports an unknown template with the way to find the id', async () => {
    const { tool, templates } = harness();
    templates.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.deleteTemplate(
        { id: 'nope', confirm: true },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_templates');
    expect(templates.delete).not.toHaveBeenCalled();
  });

  it('refuses without confirm, naming the template, and deletes nothing', async () => {
    const { tool, templates } = harness();
    const result = await tool.deleteTemplate({ id: 'tpl-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('delete the template «Support Template»');
    expect(textOf(result)).toContain('confirm: true');
    expect(templates.countAgents).not.toHaveBeenCalled();
    expect(templates.delete).not.toHaveBeenCalled();
  });

  it('refuses while agents still use the template and says what to do', async () => {
    const { tool, templates } = harness();
    templates.countAgents.mockResolvedValue(2);
    const result = await tool.deleteTemplate(
      { id: 'tpl-1', confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('2 agents still using it');
    expect(textOf(result)).toContain('list_agents');
    expect(templates.delete).not.toHaveBeenCalled();
  });

  it('deletes a confirmed, unused template', async () => {
    const { tool, templates } = harness();
    const text = textOf(
      await tool.deleteTemplate(
        { id: 'tpl-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(templates.delete).toHaveBeenCalledWith('tpl-1');
    expect(text).toContain('"id": "tpl-1"');
    expect(text).toContain('deleted');
  });
});

describe('set_template_mcps', () => {
  it('replaces the MCP set and reminds that agents need a restart', async () => {
    const { tool, templates } = harness();
    const text = textOf(
      await tool.setTemplateMcps(
        { id: 'tpl-1', mcpServerIds: ['mcp-1', 'mcp-2'] },
        null,
        operator(),
      ),
    );
    expect(templates.setMcps).toHaveBeenCalledWith('tpl-1', ['mcp-1', 'mcp-2']);
    expect(text).toContain('"mcp-1"');
    expect(text).toContain('2 MCP servers');
    expect(text).toContain('restart_template_agents with templateId=tpl-1');
  });

  it('reports an unknown template without writing', async () => {
    const { tool, templates } = harness();
    templates.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.setTemplateMcps(
        { id: 'nope', mcpServerIds: [] },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_templates');
    expect(templates.setMcps).not.toHaveBeenCalled();
  });
});

describe('restart_template_agents', () => {
  it('reports an unknown template before asking for confirmation', async () => {
    const { tool, templates, agents } = harness();
    templates.findById.mockResolvedValue(null);
    const result = await tool.restartTemplateAgents(
      { templateId: 'nope' },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(agents.findByTemplateId).not.toHaveBeenCalled();
  });

  it('refuses without confirm and restarts nothing', async () => {
    const { tool, agents, deploy } = harness();
    const result = await tool.restartTemplateAgents(
      { templateId: 'tpl-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'restart every agent of the template «Support Template»',
    );
    expect(agents.findByTemplateId).not.toHaveBeenCalled();
    expect(deploy.restartAgent).not.toHaveBeenCalled();
  });

  it('restarts every agent of the template and reports the counts', async () => {
    const { tool, agents, deploy } = harness();
    const text = textOf(
      await tool.restartTemplateAgents(
        { templateId: 'tpl-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(agents.findByTemplateId).toHaveBeenCalledWith('tpl-1');
    expect(deploy.restartAgent).toHaveBeenCalledTimes(2);
    expect(deploy.restartAgent).toHaveBeenCalledWith('agent-a');
    expect(deploy.restartAgent).toHaveBeenCalledWith('agent-b');
    expect(text).toContain('"restarted": 2');
    expect(text).toContain('"failed": 0');
    expect(text).toContain('"total": 2');
  });

  it('counts a failed restart without stopping the others', async () => {
    const { tool, deploy } = harness();
    deploy.restartAgent.mockImplementation(async (id: string) => {
      if (id === 'agent-a') throw new Error('argo down');
    });
    const text = textOf(
      await tool.restartTemplateAgents(
        { templateId: 'tpl-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(deploy.restartAgent).toHaveBeenCalledTimes(2);
    expect(text).toContain('"restarted": 1');
    expect(text).toContain('"failed": 1');
    expect(text).toContain('restart_agent');
  });

  it('says so when no agent uses the template', async () => {
    const { tool, agents, deploy } = harness();
    agents.findByTemplateId.mockResolvedValue([]);
    const text = textOf(
      await tool.restartTemplateAgents(
        { templateId: 'tpl-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(deploy.restartAgent).not.toHaveBeenCalled();
    expect(text).toContain('"total": 0');
    expect(text).toContain('nothing to restart');
  });
});
