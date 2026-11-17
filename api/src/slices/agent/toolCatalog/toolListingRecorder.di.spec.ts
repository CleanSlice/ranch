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
import {
  ACTING_PARTY_RESOLVER,
  type IActingPartyResolver,
} from '#/mcp/interfaces/acting-party.interface';
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

/**
 * The party resolver is found the same way, under the same kind of alias:
 * AuthModule provides `ACTING_PARTY_RESOLVER` with `useExisting:
 * ActingPartyService` (CLEAN-232). A lookup that silently failed there would
 * make every agent a guest. This stand-in takes `trusted` on the agent's
 * word, which is all the snapshot needs.
 */
@Injectable()
class PartyService implements IActingPartyResolver {
  resolve(
    _bearer: unknown,
    actor: { kind?: unknown } | null | undefined,
  ): ReturnType<IActingPartyResolver['resolve']> {
    return Promise.resolve(
      actor?.kind === 'trusted' ? { kind: 'trusted' } : { kind: 'guest' },
    );
  }
}

@Module({
  providers: [
    PartyService,
    { provide: ACTING_PARTY_RESOLVER, useExisting: PartyService },
  ],
  exports: [PartyService, ACTING_PARTY_RESOLVER],
})
class PartyModule {}

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
      imports: [RecorderModule, PartyModule, HostModule],
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
          audience: 'everyone' as const,
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
    const recorder = app.get<IRecorderGateway, RecorderGateway>(
      IRecorderGateway,
    );

    // A listing that names nobody is a guest's, and is not the pod's snapshot.
    await handlers.get(ListToolsRequestSchema)!({});
    await new Promise((r) => setImmediate(r));
    expect(recorder.calls).toEqual([]);

    // The agent listing for itself: both lookups have to reach their
    // provider for this line to be recorded.
    await handlers.get(ListToolsRequestSchema)!({
      params: {
        _meta: { 'ranch/actor': { kind: 'trusted', via: 'internal' } },
      },
    });
    await new Promise((r) => setImmediate(r));

    expect(recorder.calls).toEqual([['a-9', ['list_agents']]]);
  });
});
