import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { z } from 'zod';
import { McpToolsHandler } from './mcp-tools.handler';
import { McpRegistryService } from '../mcp-registry.service';

/**
 * Per-caller tool listing (CLEAN-74). The rules that matter:
 *  - a tool that says it is not for this caller is absent from tools/list AND
 *    refused by tools/call, because a pod caches the list at connect and can
 *    hold a name that stopped applying to it;
 *  - a tool that says nothing behaves exactly as before;
 *  - a tool whose check throws stays listed — a broken check must never be
 *    able to silently remove a working tool.
 */

type Handler = (request: unknown) => Promise<any>;

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
      parameters: z.object({}),
    },
    providerClass: t.name as unknown as symbol,
    methodName: 'run',
  }));

  const registry = {
    getTools: () => discovered,
    findTool: (name: string) => discovered.find((d) => d.metadata.name === name),
  } as unknown as McpRegistryService;

  const moduleRef = {
    registerRequestByContextId: jest.fn(),
    resolve: jest.fn(async (token: unknown) => {
      const tool = tools.find((t) => t.name === token);
      if (!tool) throw new Error(`no provider for ${String(token)}`);
      if (tool.resolveThrows) throw new Error('resolve blew up');
      return tool.instance;
    }),
  } as unknown as ModuleRef;

  const handlers = new Map<unknown, Handler>();
  const mcpServer = {
    server: {
      transport: { sessionId: undefined },
      setRequestHandler: (schema: unknown, handler: Handler) => {
        handlers.set(schema, handler);
      },
    },
  } as unknown as McpServer;

  const httpRequest = { user: { sub: 'agent:a1' } } as unknown as Request;

  const handler = new McpToolsHandler(moduleRef, registry);
  handler.registerHandlers(mcpServer, httpRequest);

  const list = () => handlers.get(ListToolsRequestSchema)!({});
  const call = (name: string) =>
    handlers.get(CallToolRequestSchema)!({
      params: { name, arguments: {} },
    });

  return { list, call, httpRequest };
}

const ok = (text: string) => ({ content: [{ type: 'text', text }] });

describe('McpToolsHandler — per-caller listing', () => {
  it('lists a tool that declares no opinion, with its static description', async () => {
    const { list } = makeHarness([
      { name: 'plain', instance: { run: jest.fn(async () => ok('ran')) } },
    ]);

    const result = await list();

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      name: 'plain',
      description: 'static description of plain',
    });
  });

  it('omits a tool that is not listed for this caller', async () => {
    const { list } = makeHarness([
      { name: 'plain', instance: { run: jest.fn(async () => ok('ran')) } },
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(async () => ok('delegated')),
          isListedForRequest: jest.fn(async () => false),
        },
      },
    ]);

    const result = await list();

    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(['plain']);
  });

  it('lists a tool that answers true, and passes the request to the check', async () => {
    const isListedForRequest = jest.fn(async () => true);
    const { list, httpRequest } = makeHarness([
      {
        name: 'ask_agent',
        instance: { run: jest.fn(), isListedForRequest },
      },
    ]);

    const result = await list();

    expect(result.tools).toHaveLength(1);
    expect(isListedForRequest).toHaveBeenCalledWith(httpRequest);
  });

  it('keeps a tool listed when its own check throws', async () => {
    const { list } = makeHarness([
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(),
          isListedForRequest: jest.fn(async () => {
            throw new Error('gateway down');
          }),
        },
      },
    ]);

    const result = await list();

    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      'ask_agent',
    ]);
  });

  it('keeps a tool listed when the provider cannot be resolved', async () => {
    const { list } = makeHarness([
      { name: 'plain', instance: {}, resolveThrows: true },
    ]);

    const result = await list();

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].description).toBe('static description of plain');
  });

  it('still applies a dynamic description to a listed tool', async () => {
    const { list } = makeHarness([
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(),
          isListedForRequest: jest.fn(async () => true),
          describeForRequest: jest.fn(async () => 'your peers: «B»'),
        },
      },
    ]);

    const result = await list();

    expect(result.tools[0].description).toBe('your peers: «B»');
  });

  it('never asks for a description of a tool it has already excluded', async () => {
    const describeForRequest = jest.fn(async () => 'never used');
    const { list } = makeHarness([
      {
        name: 'ask_agent',
        instance: {
          run: jest.fn(),
          isListedForRequest: jest.fn(async () => false),
          describeForRequest,
        },
      },
    ]);

    await list();

    expect(describeForRequest).not.toHaveBeenCalled();
  });
});

describe('McpToolsHandler — per-caller calling', () => {
  it('refuses a call to a tool that is not listed for this caller', async () => {
    const run = jest.fn(async () => ok('delegated'));
    const { call } = makeHarness([
      {
        name: 'ask_agent',
        instance: { run, isListedForRequest: jest.fn(async () => false) },
      },
    ]);

    const result = await call('ask_agent');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available to this caller');
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a tool that is listed for this caller', async () => {
    const run = jest.fn(async () => ok('delegated'));
    const { call } = makeHarness([
      {
        name: 'ask_agent',
        instance: { run, isListedForRequest: jest.fn(async () => true) },
      },
    ]);

    const result = await call('ask_agent');

    expect(result.content[0].text).toBe('delegated');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs a tool that declares no opinion', async () => {
    const run = jest.fn(async () => ok('ran'));
    const { call } = makeHarness([{ name: 'plain', instance: { run } }]);

    const result = await call('plain');

    expect(result.content[0].text).toBe('ran');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
