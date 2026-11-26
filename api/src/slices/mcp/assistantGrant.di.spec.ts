import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Request } from 'express';
import { z } from 'zod';
import { UserRoleTypes } from '#/user/user/domain';
import {
  ACTING_PARTY_RESOLVER,
  type IActingPartyResolver,
} from './interfaces/acting-party.interface';
import {
  ASSISTANT_GRANT_RESOLVER,
  type IAssistantGrantResolver,
} from './interfaces/assistant-grant.interface';
import { CallerToolPolicy } from './interfaces/caller-tool-policy.interface';
import { McpToolsHandler } from './services/handlers/mcp-tools.handler';
import { McpRegistryService } from './services/mcp-registry.service';
import { ToolCatalogService } from './services/tool-catalog.service';
import { callerPerson } from './tooling';

/**
 * Two lookups the tools handler makes through `ModuleRef.get(token, {
 * strict: false })`, in the real Nest container (CLEAN-254). A mock
 * `ModuleRef` cannot show either going wrong, and each going wrong is silent:
 *
 *  - the catalogue. Slices register caller tool policies on the injected
 *    `ToolCatalogService` at start. The handler is built by hand, and used to
 *    build a catalogue of its own, which knew none of them: what a setting
 *    took away was still listed and still ran;
 *  - the assistant-grant resolver, provided by another module under a
 *    `useExisting` alias, exactly as AssistantAccessModule provides it. Not
 *    found, an agent ability given to a User is a switch that does nothing.
 */

/** Every tool below is this one provider; what it does is not the subject. */
@Injectable()
class ToolRunner {
  run() {
    return Promise.resolve({ content: [{ type: 'text', text: 'ran' }] });
  }
}

const tool = (name: string, audience: string) => ({
  type: 'tool' as const,
  metadata: {
    name,
    description: name,
    parameters: z.object({}),
    topic: 'agents',
    title: name,
    template: name,
    effect: 'write',
  },
  providerClass: ToolRunner,
  methodName: 'run',
  audience,
});
const TOOLS = [
  tool('list_agents', 'reader'),
  tool('restart_agent', 'manage-agent'),
  tool('delete_agent', 'manage-agent'),
  tool('get_agent', 'reader'),
];
const registry = {
  getTools: () => TOOLS,
  findTool: (name: string) => TOOLS.find((t) => t.metadata.name === name),
};

/** Stands in for McpModule: the registry, the one catalogue, a ModuleRef. */
@Injectable()
class HandlerHost {
  constructor(public readonly moduleRef: ModuleRef) {}
}

@Global()
@Module({
  providers: [
    { provide: McpRegistryService, useValue: registry },
    ToolCatalogService,
    HandlerHost,
    ToolRunner,
  ],
  exports: [McpRegistryService, ToolCatalogService],
})
class McpLikeModule {}

/**
 * Stands in for the assistantAccess slice: a setting that gives every User
 * `restart_agent` and takes `get_agent` away from everybody it applies to.
 */
@Injectable()
class SettingPolicy
  extends CallerToolPolicy
  implements IAssistantGrantResolver
{
  allowedToolsFor(httpRequest: Request): Promise<Set<string> | null> {
    return Promise.resolve(
      callerPerson(httpRequest)
        ? new Set(['list_agents', 'restart_agent'])
        : null,
    );
  }

  grantedToolsFor(httpRequest: Request): Promise<ReadonlySet<string> | null> {
    return Promise.resolve(
      callerPerson(httpRequest)?.role === UserRoleTypes.User
        ? new Set(['restart_agent'])
        : null,
    );
  }
}

@Injectable()
class SettingWiring implements OnModuleInit {
  constructor(
    private readonly catalog: ToolCatalogService,
    private readonly policy: SettingPolicy,
  ) {}

  onModuleInit(): void {
    this.catalog.addPolicy(this.policy);
  }
}

@Module({
  providers: [
    SettingPolicy,
    SettingWiring,
    { provide: ASSISTANT_GRANT_RESOLVER, useExisting: SettingPolicy },
  ],
})
class SettingModule {}

/** Every call is made for the same User, as an acting token would prove. */
@Injectable()
class PartyService implements IActingPartyResolver {
  resolve(): ReturnType<IActingPartyResolver['resolve']> {
    return Promise.resolve({
      kind: 'person',
      userId: 'user-1',
      role: UserRoleTypes.User,
    });
  }
}

@Module({
  providers: [
    PartyService,
    { provide: ACTING_PARTY_RESOLVER, useExisting: PartyService },
  ],
})
class PartyModule {}

describe('the tools handler in a real container (CLEAN-254)', () => {
  it('lists from the application’s catalogue and finds the grant behind its alias', async () => {
    const app = await Test.createTestingModule({
      imports: [McpLikeModule, SettingModule, PartyModule],
    }).compile();
    await app.init();

    const handlers = new Map<
      unknown,
      (r: unknown) => Promise<{
        tools: { name: string }[];
        content: { text: string }[];
      }>
    >();
    const mcpServer = {
      server: {
        transport: { sessionId: undefined },
        setRequestHandler: (schema: unknown, fn: never) =>
          handlers.set(schema, fn),
      },
    } as unknown as McpServer;
    const httpRequest = {
      user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
    } as unknown as Request;

    new McpToolsHandler(
      app.get(HandlerHost).moduleRef,
      registry as unknown as McpRegistryService,
    ).registerHandlers(mcpServer, httpRequest);

    const listed = await handlers.get(ListToolsRequestSchema)!({ params: {} });
    // `restart_agent`: the grant was found, for a User who manages nothing.
    // No `delete_agent`: the grant is that one tool. No `get_agent`: the
    // policy registered on the injected catalogue narrowed this listing.
    expect(listed.tools.map((t) => t.name)).toEqual([
      'list_agents',
      'restart_agent',
    ]);

    const call = async (name: string) =>
      (
        await handlers.get(CallToolRequestSchema)!({
          params: { name, arguments: {} },
        })
      ).content[0].text;
    expect(await call('restart_agent')).toBe('ran');
    expect(await call('delete_agent')).toBe(
      'Tool "delete_agent" is not available to this caller.',
    );
    expect(await call('get_agent')).toBe(
      'Tool "get_agent" is not available to this caller.',
    );

    await app.close();
  });
});
