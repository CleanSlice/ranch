import type { Request } from 'express';
import { AgentController } from './agent.controller';
import {
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import type { IMcpServerData } from '#/mcpServer/domain';

// getMcps only: the controller has eleven collaborators, and this path
// touches four of them. Everything else is an inert stub.

function mcp(id: string, name: string, enabled = true): IMcpServerData {
  return {
    id,
    name,
    description: null,
    url: 'http://api:3001/mcp/mcp',
    transport: 'streamableHttp',
    authType: 'bearer',
    authValue: '${RANCH_API_TOKEN}',
    enabled,
    builtIn: true,
    templateIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as IMcpServerData;
}

function build(opts: {
  templateMcps: IMcpServerData[];
  byId: Record<string, IMcpServerData | null>;
  knowledgeIds?: string[];
}) {
  const agentGateway = {
    findById: jest.fn(async () => ({
      id: 'ag-1',
      templateId: 'tpl-1',
      knowledgeIds: opts.knowledgeIds ?? [],
    })),
  };
  const templateGateway = {
    findById: jest.fn(async () => ({
      id: 'tpl-1',
      mcpServerIds: opts.templateMcps.map((m) => m.id),
      defaultKnowledgeIds: [],
    })),
  };
  const mcpServerGateway = {
    findByIds: jest.fn(async () => opts.templateMcps),
    findById: jest.fn(async (id: string) => opts.byId[id] ?? null),
  };
  const knowledgeConfig = { isEnabled: jest.fn(async () => false) };
  const knowledgeGateway = { findExistingByIds: jest.fn(async () => []) };
  const stub = {} as never;
  const controller = new AgentController(
    agentGateway as never,
    templateGateway as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    mcpServerGateway as never,
    stub,
    knowledgeGateway as never,
    knowledgeConfig as never,
  );
  return { controller, mcpServerGateway };
}

const asOwner = {
  user: { sub: 'user-1', roles: ['owner'] },
} as unknown as Request;

describe('AgentController.getMcps — Documents injection', () => {
  it('adds the built-in Documents entry for an agent whose template has none', async () => {
    const { controller } = build({
      templateMcps: [mcp(RANCH_MCP_ID, 'Ranch')],
      byId: { [DOCUMENTS_MCP_ID]: mcp(DOCUMENTS_MCP_ID, 'Documents') },
    });

    const out = await controller.getMcps('ag-1', asOwner);

    expect(out.map((m) => m.name)).toEqual(['Ranch', 'Documents']);
  });

  it('does not add it twice when the template already attaches it', async () => {
    const { controller, mcpServerGateway } = build({
      templateMcps: [mcp(DOCUMENTS_MCP_ID, 'Documents')],
      byId: { [DOCUMENTS_MCP_ID]: mcp(DOCUMENTS_MCP_ID, 'Documents') },
    });

    const out = await controller.getMcps('ag-1', asOwner);

    expect(out.map((m) => m.name)).toEqual(['Documents']);
    expect(mcpServerGateway.findById).not.toHaveBeenCalledWith(
      DOCUMENTS_MCP_ID,
    );
  });

  it('skips it when an operator disabled the entry', async () => {
    const { controller } = build({
      templateMcps: [],
      byId: { [DOCUMENTS_MCP_ID]: mcp(DOCUMENTS_MCP_ID, 'Documents', false) },
    });

    expect(await controller.getMcps('ag-1', asOwner)).toEqual([]);
  });

  it('leaves the knowledge injection untouched', async () => {
    const { controller } = build({
      templateMcps: [],
      byId: {
        [DOCUMENTS_MCP_ID]: mcp(DOCUMENTS_MCP_ID, 'Documents'),
        [KNOWLEDGE_MCP_ID]: mcp(KNOWLEDGE_MCP_ID, 'Knowledge'),
      },
      knowledgeIds: ['kb-1'],
    });

    // knowledgeConfig.isEnabled() is false in the stub → no Knowledge entry.
    const out = await controller.getMcps('ag-1', asOwner);
    expect(out.map((m) => m.name)).toEqual(['Documents']);
  });
});
