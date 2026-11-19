import { ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { z } from 'zod';
import { ToolCatalogService } from './tool-catalog.service';
import { McpRegistryService } from '../services/mcp-registry.service';
import type { ToolAudienceTypes } from '../decorators';
import { asGuest, asPerson, asTrustedAgent } from '../testing';
import { UserRoleTypes } from '#/user/user/domain';

interface FakeTool {
  name: string;
  instance: Record<string, unknown>;
  resolveThrows?: boolean;
  /** Defaults to `everyone`; `null` is a tool that declared none. */
  audience?: ToolAudienceTypes | null;
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
    ...(t.audience === null ? {} : { audience: t.audience ?? 'everyone' }),
  }));
  const registry = {
    getTools: () => discovered,
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
  return { service: new ToolCatalogService(moduleRef, registry), moduleRef };
}

// Token roles are lower-case on purpose in these two: the hooks under test
// read whatever the fake tool wants, and the audience is `everyone`.
const operator = () =>
  ({ user: { sub: 'agent:admin', roles: ['owner'] } }) as unknown as Request;
const plain = () =>
  ({ user: { sub: 'agent:a1', roles: ['agent'] } }) as unknown as Request;

const ranchAgent = () =>
  ({
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;
const plainAgent = () =>
  ({
    user: { sub: 'agent:helper', email: '', roles: [UserRoleTypes.Agent] },
  }) as unknown as Request;

/**
 * CLEAN-232: the audience is the first question, asked before any hook of
 * the tool, and it is answered for the party the request is made for.
 */
describe('ToolCatalogService audience', () => {
  const fiveTools = (hook = jest.fn(async () => true)) =>
    makeHarness([
      { name: 'query_knowledge', instance: {}, audience: 'everyone' },
      { name: 'list_my_peers', instance: {}, audience: 'agent' },
      { name: 'browser_session_list', instance: {}, audience: 'person' },
      {
        name: 'delete_agent',
        instance: { isListedForRequest: hook },
        audience: 'admin',
      },
      { name: 'delete_user', instance: {}, audience: 'owner' },
    ]);
  const names = async (
    service: ToolCatalogService,
    req: Request,
  ): Promise<string[]> => (await service.listFor(req)).map((t) => t.name);

  it('the Ranch admin agent acting for itself sees everything but person tools', async () => {
    const { service } = fiveTools();
    expect(await names(service, asTrustedAgent(ranchAgent()))).toEqual([
      'query_knowledge',
      'list_my_peers',
      'delete_agent',
      'delete_user',
    ]);
  });

  it('the same agent answering a User lists nothing an administrator has', async () => {
    const { service } = fiveTools();
    expect(
      await names(service, asPerson(ranchAgent(), UserRoleTypes.User)),
    ).toEqual(['query_knowledge', 'list_my_peers', 'browser_session_list']);
  });

  it('answering an Admin it lists admin tools and not the Owner’s', async () => {
    const { service } = fiveTools();
    expect(
      await names(service, asPerson(ranchAgent(), UserRoleTypes.Admin)),
    ).toEqual([
      'query_knowledge',
      'list_my_peers',
      'browser_session_list',
      'delete_agent',
    ]);
  });

  it('answering the Owner it lists all five', async () => {
    const { service } = fiveTools();
    expect(
      await names(service, asPerson(ranchAgent(), UserRoleTypes.Owner)),
    ).toHaveLength(5);
  });

  it('a call that names nobody is a guest’s: no management tool, hooks not asked', async () => {
    const hook = jest.fn(async () => true);
    const { service } = fiveTools(hook);

    expect(await names(service, ranchAgent())).toEqual([
      'query_knowledge',
      'list_my_peers',
    ]);
    expect(await names(service, asGuest(ranchAgent()))).toEqual([
      'query_knowledge',
      'list_my_peers',
    ]);
    // A hook that would have said yes is never consulted: the audience has
    // no "stay listed when the check breaks" fallback to fall into.
    expect(hook).not.toHaveBeenCalled();
  });

  it('a plain agent gains nothing by being trusted or by naming the Owner', async () => {
    const { service } = fiveTools();
    expect(await names(service, asTrustedAgent(plainAgent()))).toEqual([
      'query_knowledge',
      'list_my_peers',
    ]);
    expect(
      await names(service, asPerson(plainAgent(), UserRoleTypes.Owner)),
    ).toEqual(['query_knowledge', 'list_my_peers', 'browser_session_list']);
  });

  it('never lists a tool that declared no audience, whoever asks', async () => {
    const { service } = makeHarness([
      { name: 'undeclared', instance: {}, audience: null },
    ]);
    expect(await names(service, asTrustedAgent(ranchAgent()))).toEqual([]);
    expect(
      await names(service, asPerson(ranchAgent(), UserRoleTypes.Owner)),
    ).toEqual([]);
  });

  it('says which audience each listed tool has', async () => {
    const { service } = fiveTools();
    const listed = await service.listFor(asTrustedAgent(ranchAgent()));
    expect(listed.map((t) => t.audience)).toEqual([
      'everyone',
      'agent',
      'admin',
      'owner',
    ]);
  });
});

describe('ToolCatalogService caller tool policy (CLEAN-209)', () => {
  const twoTools = () =>
    makeHarness([
      { name: 'query_knowledge', instance: { run: jest.fn() } },
      { name: 'delete_agent', instance: { run: jest.fn() } },
    ]);

  it('lists every tool when no policy is registered (moduleRef.get missing or throwing)', async () => {
    const { service } = twoTools();
    expect(await service.listFor(plain())).toHaveLength(2);
    expect(await service.allowedNamesFor(plain())).toBeNull();
  });

  it('keeps only the names the policy allows, and tells the handler the same', async () => {
    const { service, moduleRef } = twoTools();
    (moduleRef as unknown as { get: jest.Mock }).get = jest.fn(() => ({
      allowedToolsFor: async () => new Set(['query_knowledge']),
    }));
    const listed = await service.listFor(plain());
    expect(listed.map((t) => t.name)).toEqual(['query_knowledge']);
    const allowed = await service.allowedNamesFor(plain());
    expect(allowed?.has('delete_agent')).toBe(false);
  });

  it('a policy answering null changes nothing', async () => {
    const { service, moduleRef } = twoTools();
    (moduleRef as unknown as { get: jest.Mock }).get = jest.fn(() => ({
      allowedToolsFor: async () => null,
    }));
    expect(await service.listFor(plain())).toHaveLength(2);
  });
});

describe('ToolCatalogService.listFor', () => {
  it('lists a tool with no opinion, with its static description, schema and metadata', async () => {
    const { service } = makeHarness([
      { name: 'plain', instance: { run: jest.fn() } },
    ]);
    const result = await service.listFor(plain());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('plain');
    expect(result[0].description).toBe('static description of plain');
    expect(result[0].inputSchema).toMatchObject({ type: 'object' });
    expect(result[0].metadata.template).toBe('Do «plain»');
  });

  it('omits a tool whose listing hook says no and asks it with the request', async () => {
    const isListedForRequest = jest.fn(async (req: Request) =>
      (req as unknown as { user: { roles: string[] } }).user.roles.includes(
        'owner',
      ),
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
