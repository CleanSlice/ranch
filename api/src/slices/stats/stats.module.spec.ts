import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { InstallationStatsController } from './installationStats.controller';
import { MyStatsController } from './myStats.controller';
import { StatsModule } from './stats.module';

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
 * The statistics slice reads every fact through another slice's gateway or
 * service (CLEAN-258), so its providers are built almost entirely from
 * things other modules export. A dependency that no imported module exports
 * compiles, passes every spec that builds the service by hand, and stops the
 * API at boot. This reads the module the way Nest resolves it: each
 * constructor parameter of each provider and controller must be the
 * module's own provider, an export of a module it imports, or a provider of
 * a global module.
 */

type Token = abstract new (...args: never[]) => unknown;

/** Provided by modules marked `@Global()`: no import is needed for them. */
const GLOBAL: unknown[] = [
  PrismaService,
  AgentAccessService,
  AgentPermissionService,
];

const metadata = <T>(key: string, target: object): T[] =>
  (Reflect.getMetadata(key, target) as T[] | undefined) ?? [];

const tokenOf = (provider: unknown): unknown =>
  typeof provider === 'function'
    ? provider
    : (provider as { provide: unknown }).provide;

const classOf = (provider: unknown): Token | undefined => {
  if (typeof provider === 'function') return provider as Token;
  return (provider as { useClass?: Token }).useClass;
};

describe('StatsModule', () => {
  const imports = metadata<object>(MODULE_METADATA.IMPORTS, StatsModule);
  const providers = metadata<unknown>(MODULE_METADATA.PROVIDERS, StatsModule);
  const controllers = metadata<Token>(MODULE_METADATA.CONTROLLERS, StatsModule);

  const available = new Set<unknown>([
    ...GLOBAL,
    ...providers.map(tokenOf),
    ...imports.flatMap((imported) =>
      metadata<unknown>(MODULE_METADATA.EXPORTS, imported).map(tokenOf),
    ),
  ]);

  it('imports modules that exist: none is undefined from an import cycle', () => {
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((imported) => typeof imported === 'function')).toBe(
      true,
    );
  });

  it('can build every provider and controller from what it provides and imports', () => {
    const missing: string[] = [];
    const classes = [
      ...providers.map(classOf).filter((c): c is Token => c !== undefined),
      ...controllers,
    ];
    for (const target of classes) {
      const params = metadata<Token | undefined>('design:paramtypes', target);
      params.forEach((param, index) => {
        if (!available.has(param)) {
          missing.push(
            `${target.name}[${index}]: ${param?.name ?? String(param)}`,
          );
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it('checks something: the personal view really has that many dependencies', () => {
    const service = providers
      .map(classOf)
      .find((c) => c?.name === 'PersonalStatsService');
    expect(service).toBeDefined();
    // Nine, and two more for what the conversation summaries say
    // (CLEAN-270): the topics by id, and whether summaries are produced at
    // all. `ChatModule` exports both for this reader.
    expect(
      metadata<Token>('design:paramtypes', service as Token).map((p) => p.name),
    ).toEqual([
      'IChatActivityGateway',
      'IChatGateway',
      'IChatTopicGateway',
      'ChatInsightService',
      'ChatSourceService',
      'IDelegationGateway',
      'IUsageGateway',
      'IAgentGateway',
      'ILlmGateway',
      'AgentAccessService',
      'FigureRegistry',
    ]);
  });

  // The installation view reads four more slices (CLEAN-265): the hours and
  // ratings of `chat`, `usage`, the refusals of `agent/limit` and the
  // incidents of `agent/event`. That last one is the module this view added
  // to the imports; without it the API does not start. Who manages an agent
  // (`AgentPermissionService`, which says whose the assistant's
  // conversations are, CLEAN-236) comes from a global module, like the access
  // lists beside it.
  it('and so has the installation view', () => {
    const service = providers
      .map(classOf)
      .find((c) => c?.name === 'InstallationStatsService');
    expect(service).toBeDefined();
    expect(
      metadata<Token>('design:paramtypes', service as Token).map((p) => p.name),
    ).toEqual([
      'IChatActivityGateway',
      'IChatGateway',
      // Whether summaries are produced: what the open share is read by
      // (CLEAN-270).
      'ChatInsightService',
      'IUsageGateway',
      'IAgentGateway',
      'AgentLimitService',
      'AgentEventService',
      'AgentAccessService',
      'AgentPermissionService',
      'FigureRegistry',
    ]);
  });

  it('gives the tool both views', () => {
    const tool = providers.map(classOf).find((c) => c?.name === 'StatsTool');
    expect(
      metadata<Token>('design:paramtypes', tool as Token).map((p) => p.name),
    ).toEqual(['PersonalStatsService', 'InstallationStatsService']);
  });

  it('serves the personal view and the installation view', () => {
    expect(controllers).toEqual([
      MyStatsController,
      InstallationStatsController,
    ]);
  });
});
