import type { Request } from 'express';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import {
  DOCUMENTS_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import type { IMcpServerData } from '#/mcpServer/domain';

/**
 * getMcps only. Which servers an agent gets is AgentMcpResolver's answer now
 * and is covered by its own spec — CLEAN-87, after two copies of that logic
 * drifted apart and left every agent without query_attachment. What is left
 * here is the controller's own job: the wire shape it hands the runtime, and
 * the self-scope rule that stops one agent reading another's auth values.
 */
function mcp(id: string, name: string): IMcpServerData {
  return {
    id,
    name,
    description: null,
    url: 'http://ranch-api.platform.svc.cluster.local/mcp/mcp',
    transport: 'streamableHttp',
    authType: 'bearer',
    authValue: '${RANCH_API_TOKEN}',
    oauthClientId: null,
    enabled: true,
    builtIn: true,
    templateIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as IMcpServerData;
}

function build(opts: { resolved?: IMcpServerData[]; agent?: unknown } = {}) {
  const agentGateway = {
    findById: jest.fn(() =>
      Promise.resolve(
        opts.agent === null
          ? null
          : { id: 'ag-1', templateId: 'tpl-1', knowledgeIds: [] },
      ),
    ),
  };
  const mcpResolver = {
    resolveForAgent: jest.fn(() => Promise.resolve(opts.resolved ?? [])),
  };
  const stub = {} as never;
  const controller = new AgentController(
    agentGateway as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    mcpResolver as never,
  );
  return { controller, mcpResolver, agentGateway };
}

const asOwner = {
  user: { sub: 'user-1', roles: ['owner'] },
} as unknown as Request;

const asAgent = (id: string) =>
  ({ user: { sub: `agent:${id}`, roles: ['agent'] } }) as unknown as Request;

describe('AgentController.getMcps', () => {
  it('hands the runtime what the resolver decided, in wire shape', async () => {
    const { controller } = build({
      resolved: [
        mcp(RANCH_MCP_ID, 'Ranch'),
        mcp(DOCUMENTS_MCP_ID, 'Documents'),
      ],
    });

    const out = await controller.getMcps('ag-1', asOwner);

    expect(out.map((m) => m.name)).toEqual(['Ranch', 'Documents']);
    expect(out[0]).toEqual({
      id: RANCH_MCP_ID,
      name: 'Ranch',
      transport: 'streamableHttp',
      url: 'http://ranch-api.platform.svc.cluster.local/mcp/mcp',
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
      enabled: true,
    });
  });

  it('asks the resolver about this agent, not some other', async () => {
    const { controller, mcpResolver } = build();

    await controller.getMcps('ag-1', asOwner);

    expect(mcpResolver.resolveForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl-1' }),
    );
  });

  it('lets an agent token read its own list', async () => {
    const { controller } = build({
      resolved: [mcp(DOCUMENTS_MCP_ID, 'Documents')],
    });

    const out = await controller.getMcps('ag-1', asAgent('ag-1'));

    expect(out.map((m) => m.name)).toEqual(['Documents']);
  });

  it('refuses an agent token pointed at a peer', async () => {
    // Otherwise an agent could enumerate its neighbours' MCPs — and their
    // auth values travel in this response.
    const { controller } = build();

    await expect(controller.getMcps('ag-2', asAgent('ag-1'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s on an unknown agent', async () => {
    const { controller } = build({ agent: null });

    await expect(controller.getMcps('nope', asOwner)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns an empty list rather than failing when nothing resolves', async () => {
    const { controller } = build({ resolved: [] });

    expect(await controller.getMcps('ag-1', asOwner)).toEqual([]);
  });
});
