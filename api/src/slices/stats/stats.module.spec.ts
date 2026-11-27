import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
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
const GLOBAL: unknown[] = [PrismaService, AgentAccessService];

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
    expect(metadata('design:paramtypes', service as Token)).toHaveLength(9);
  });

  it('serves the personal view', () => {
    expect(controllers).toEqual([MyStatsController]);
  });
});
