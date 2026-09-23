import { ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { z } from 'zod';
import { ToolCatalogService } from './tool-catalog.service';
import { McpRegistryService } from '../services/mcp-registry.service';

interface FakeTool {
  name: string;
  instance: Record<string, unknown>;
  resolveThrows?: boolean;
}

function makeHarness(tools: FakeTool[]) {
  const discovered = tools.map((t) => ({
    type: 'tool' as const,
    metadata: {
      name: t.name,
      description: `static description of ${t.name}`,
      parameters: z.object({ id: z.string() }),
      topic: 'agents',
      title: t.name,
      template: `Do «${t.name}»`,
    },
    providerClass: t.name as unknown as symbol,
    methodName: 'run',
  }));
  const registry = { getTools: () => discovered } as unknown as McpRegistryService;
  const moduleRef = {
    registerRequestByContextId: jest.fn(),
    resolve: jest.fn(async (token: unknown) => {
      const tool = tools.find((t) => t.name === token);
      if (!tool) throw new Error(`no provider for ${String(token)}`);
      if (tool.resolveThrows) throw new Error('resolve blew up');
      return tool.instance;
    }),
  } as unknown as ModuleRef;
  return { service: new ToolCatalogService(moduleRef, registry), moduleRef };
}

const operator = () =>
  ({ user: { sub: 'agent:admin', roles: ['owner'] } }) as unknown as Request;
const plain = () =>
  ({ user: { sub: 'agent:a1', roles: ['agent'] } }) as unknown as Request;

describe('ToolCatalogService.listFor', () => {
  it('lists a tool with no opinion, with its static description, schema and metadata', async () => {
    const { service } = makeHarness([{ name: 'plain', instance: { run: jest.fn() } }]);
    const result = await service.listFor(plain());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('plain');
    expect(result[0].description).toBe('static description of plain');
    expect(result[0].inputSchema).toMatchObject({ type: 'object' });
    expect(result[0].metadata.template).toBe('Do «plain»');
  });

  it('omits a tool whose listing hook says no and asks it with the request', async () => {
    const isListedForRequest = jest.fn(async (req: Request) =>
      (req as unknown as { user: { roles: string[] } }).user.roles.includes('owner'),
    );
    const { service } = makeHarness([
      { name: 'delete_user', instance: { run: jest.fn(), isListedForRequest } },
    ]);
    expect(await service.listFor(plain())).toHaveLength(0);
    expect(await service.listFor(operator())).toHaveLength(1);
    expect(isListedForRequest).toHaveBeenCalledTimes(2);
  });

  it('applies a dynamic description when one is given', async () => {
    const { service } = makeHarness([
      {
        name: 'query_knowledge',
        instance: {
          run: jest.fn(),
          describeForRequest: jest.fn(async () => 'bases: «Docs»'),
        },
      },
    ]);
    const [tool] = await service.listFor(plain());
    expect(tool.description).toBe('bases: «Docs»');
  });

  it('keeps a tool listed when its hooks or resolution throw', async () => {
    const { service } = makeHarness([
      { name: 'broken', instance: {}, resolveThrows: true },
      {
        name: 'throwing',
        instance: {
          isListedForRequest: jest.fn(async () => {
            throw new Error('nope');
          }),
        },
      },
    ]);
    const result = await service.listFor(plain());
    expect(result.map((t) => t.name)).toEqual(['broken', 'throwing']);
  });
});
