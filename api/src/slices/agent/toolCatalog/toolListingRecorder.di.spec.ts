import { Injectable, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { McpToolsHandler } from '#/mcp/services/handlers/mcp-tools.handler';
import { McpRegistryService } from '#/mcp/services/mcp-registry.service';
import {
  TOOL_LISTING_RECORDER,
  type IToolListingRecorder,
} from '#/mcp/interfaces/tool-listing-recorder.interface';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * The tools handler finds the listing recorder through `ModuleRef.get(token,
 * { strict: false })` from INSIDE the mcp module, while the recorder is
 * provided by another module under a `useExisting` alias — exactly how
 * ToolCatalogModule wires it. A lookup that silently fails there means the
 * snapshot is never written and every pod reads as "after restart" forever,
 * so this test runs the real Nest container rather than a mock ModuleRef.
 */
abstract class IRecorderGateway implements IToolListingRecorder {
  abstract record(agentId: string, toolNames: string[]): Promise<void>;
}

@Injectable()
class RecorderGateway extends IRecorderGateway {
  calls: Array<[string, string[]]> = [];
  async record(agentId: string, toolNames: string[]): Promise<void> {
    this.calls.push([agentId, toolNames]);
    return Promise.resolve();
  }
}

@Module({
  providers: [
    { provide: IRecorderGateway, useClass: RecorderGateway },
    { provide: TOOL_LISTING_RECORDER, useExisting: IRecorderGateway },
  ],
  exports: [IRecorderGateway, TOOL_LISTING_RECORDER],
})
class RecorderModule {}

/** Stands in for McpModule: knows nothing about RecorderModule. */
@Injectable()
class HandlerHost {
  constructor(public readonly moduleRef: ModuleRef) {}
}

@Module({ providers: [HandlerHost] })
class HostModule {}

describe('tools/list snapshot — real container lookup (CLEAN-109)', () => {
  it('the handler reaches a recorder provided under a useExisting alias in another module', async () => {
    const app = await Test.createTestingModule({
      imports: [RecorderModule, HostModule],
    }).compile();

    const host = app.get(HandlerHost);
    const registry = {
      getTools: () => [
        {
          type: 'tool' as const,
          metadata: {
            name: 'list_agents',
            description: 'x',
            parameters: z.object({}),
            topic: 'agents',
            title: 'List agents',
            template: 'List all agents',
          },
          providerClass: Symbol('none'),
          methodName: 'run',
        },
      ],
      findTool: () => undefined,
    } as unknown as McpRegistryService;

    const handlers = new Map<unknown, (r: unknown) => Promise<unknown>>();
    const mcpServer = {
      server: {
        transport: { sessionId: 'sess-1' },
        setRequestHandler: (schema: unknown, fn: (r: unknown) => Promise<unknown>) =>
          handlers.set(schema, fn),
      },
    } as unknown as McpServer;
    const httpRequest = {
      user: { sub: 'agent:a-9', email: '', roles: ['agent'] },
    } as unknown as Request;

    const handler = new McpToolsHandler(host.moduleRef, registry);
    handler.registerHandlers(mcpServer, httpRequest);
    await handlers.get(ListToolsRequestSchema)!({});
    await new Promise((r) => setImmediate(r));

    const recorder = app.get<IRecorderGateway, RecorderGateway>(
      IRecorderGateway,
    );
    expect(recorder.calls).toEqual([['a-9', ['list_agents']]]);
  });
});
