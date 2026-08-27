import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ConfigModule } from '../config/config.module';
import { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';
import { ILightragClient } from './domain/lightrag.client';
import {
  LightragHttpClient,
  ILightragCallContext,
  LightragRequestConfig,
} from './data/lightragHttp.client';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    {
      provide: ILightragClient,
      inject: [IKnowledgeConfigGateway, PrismaService],
      useFactory: (cfg: IKnowledgeConfigGateway, prisma: PrismaService) =>
        new LightragHttpClient({
          // Routing policy — the one place that decides which endpoint a
          // call hits during and after the transition off the shared pool:
          //   * migrated base ('done'): its own instance, for reads AND
          //     writes. Never falls back to the shared pool — a fallback
          //     would silently serve another era's content, which is the
          //     exact leak this feature removes.
          //   * unmigrated base: reads stay on the shared pool (it still
          //     holds the content); writes go to the base's own instance as
          //     soon as it is ready — that is how the migration re-ingests
          //     without flipping reads early.
          //   * no context: shared/legacy endpoint (health checks).
          resolveConfig: async (
            ctx?: ILightragCallContext,
          ): Promise<LightragRequestConfig> => {
            const c = await cfg.resolve();
            const shared = { url: c.url, apiKey: c.apiKey, enabled: c.enabled };
            if (!ctx) return shared;

            const k = await prisma.knowledge.findUnique({
              where: { id: ctx.knowledgeId },
              select: {
                migrationState: true,
                instanceState: true,
                instanceEndpoint: true,
              },
            });
            if (!k) return shared;

            const own =
              k.instanceState === 'ready' && k.instanceEndpoint
                ? k.instanceEndpoint
                : null;

            if (k.migrationState === 'done') {
              return {
                url: own ?? '',
                apiKey: c.apiKey,
                enabled: c.enabled && own !== null,
              };
            }
            if (ctx.intent === 'write' && own) {
              return { url: own, apiKey: c.apiKey, enabled: c.enabled };
            }
            return shared;
          },
        }),
    },
  ],
  exports: [ILightragClient],
})
export class LightragModule {}
