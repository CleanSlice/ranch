import { Global, Injectable, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Request } from 'express';
import { z } from 'zod';
import { UserRoleTypes } from '#/user/user/domain';
import {
  ACTING_PARTY_RESOLVER,
  type IActingPartyResolver,
} from './interfaces/acting-party.interface';
import {
  ASSISTANT_BUILD_RESOLVER,
  type IAssistantBuild,
  type IAssistantBuildResolver,
} from './interfaces/assistant-build.interface';
import { McpToolsHandler } from './services/handlers/mcp-tools.handler';
import { McpRegistryService } from './services/mcp-registry.service';
import { ToolCatalogService } from './services/tool-catalog.service';
import { builtFromRefusal, ok } from './tooling';

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
 * The lookup the tools handler makes for "what is the assistant built from"
 * (CLEAN-271), through `ModuleRef.get(token, { strict: false })`, in a real
 * Nest container. A mock `ModuleRef` cannot show it going wrong, and going
 * wrong is silent in the worst direction: with no resolver found nothing is
 * noted, and every write to the assistant's ingredients goes through.
 *
 * Two things are held here. The handler finds a resolver provided by another
 * module under a `useExisting` alias, exactly as AssistantBuildModule
 * provides it. And the application's root module does import that module,
 * which is global and exports the token.
 */

@Injectable()
class SkillWriter {
  written: string[] = [];

  write(args: { id: string }, _context: unknown, httpRequest: Request) {
    const refused = builtFromRefusal(httpRequest, 'skill', args.id, args.id);
    if (refused) return Promise.resolve(refused);
    this.written.push(args.id);
    return Promise.resolve(ok({ written: args.id }));
  }
}

const TOOLS = [
  {
    type: 'tool' as const,
    metadata: {
      name: 'update_skill',
      description: 'update_skill',
      parameters: z.object({ id: z.string() }),
      topic: 'skills',
      title: 'update_skill',
      template: 'update_skill',
      effect: 'write',
    },
    providerClass: SkillWriter,
    methodName: 'write',
    audience: 'admin',
  },
];
const registry = {
  getTools: () => TOOLS,
  findTool: (name: string) => TOOLS.find((t) => t.metadata.name === name),
};

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
    SkillWriter,
  ],
  exports: [McpRegistryService, ToolCatalogService],
})
class McpLikeModule {}

/** Stands in for the agent slice: one skill is the assistant's. */
@Injectable()
class BuildService implements IAssistantBuildResolver {
  ingredients(): Promise<IAssistantBuild> {
    return Promise.resolve({
      template: [],
      skill: ['skill-of-the-assistant'],
      mcpServer: [],
      llmCredential: [],
      knowledge: [],
    });
  }
}

@Global()
@Module({
  providers: [
    BuildService,
    { provide: ASSISTANT_BUILD_RESOLVER, useExisting: BuildService },
  ],
  exports: [BuildService, ASSISTANT_BUILD_RESOLVER],
})
class BuildModule {}

@Injectable()
class PartyService implements IActingPartyResolver {
  role = UserRoleTypes.Admin;

  resolve(): ReturnType<IActingPartyResolver['resolve']> {
    return Promise.resolve({
      kind: 'person',
      userId: 'user-1',
      role: this.role,
    });
  }
}

@Module({
  providers: [
    PartyService,
    { provide: ACTING_PARTY_RESOLVER, useExisting: PartyService },
  ],
  exports: [PartyService],
})
class PartyModule {}

describe('the tools handler in a real container (CLEAN-271)', () => {
  it('finds what the assistant is built from behind its alias, and a tool refuses on it', async () => {
    const app = await Test.createTestingModule({
      imports: [McpLikeModule, BuildModule, PartyModule],
    }).compile();
    await app.init();

    const handlers = new Map<
      unknown,
      (r: unknown) => Promise<{ content: { text: string }[] }>
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
    const call = async (id: string) =>
      JSON.parse(
        (
          await handlers.get(CallToolRequestSchema)!({
            params: {
              name: 'update_skill',
              arguments: { id },
              _meta: { 'ranch/actor': { kind: 'person', token: 't' } },
            },
          })
        ).content[0].text,
      ) as Record<string, unknown>;
    const writer = app.get(SkillWriter);

    // An Admin: the assistant's skill is refused, any other is written.
    expect(await call('skill-of-the-assistant')).toEqual({
      error:
        'The skill «skill-of-the-assistant» is part of what the Ranch ' +
        'assistant is built from. Only the Owner can change it.',
      reason: 'owner_only',
    });
    expect(await call('skill-of-somebody')).toEqual({
      written: 'skill-of-somebody',
    });
    expect(writer.written).toEqual(['skill-of-somebody']);

    // The Owner: nothing is noted, nothing is refused.
    app.get(PartyService).role = UserRoleTypes.Owner;
    expect(await call('skill-of-the-assistant')).toEqual({
      written: 'skill-of-the-assistant',
    });

    await app.close();
  });

  it('the application imports the module that provides it, global and exported', async () => {
    const { AppModule } = await import('../../app.module');
    const { AssistantBuildModule } =
      await import('#/agent/assistantBuild/assistantBuild.module');
    const { AssistantBuildService } =
      await import('#/agent/assistantBuild/domain/assistantBuild.service');

    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];
    expect(imports).toContain(AssistantBuildModule);

    expect(Reflect.getMetadata('__module:global__', AssistantBuildModule)).toBe(
      true,
    );
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AssistantBuildModule,
    ) as unknown[];
    expect(providers).toContainEqual({
      provide: ASSISTANT_BUILD_RESOLVER,
      useExisting: AssistantBuildService,
    });
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, AssistantBuildModule),
    ).toContain(ASSISTANT_BUILD_RESOLVER);
  });
});
