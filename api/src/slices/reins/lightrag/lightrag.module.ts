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
import { routeLightragConfig } from './data/lightragRouting';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    {
      provide: ILightragClient,
      inject: [IKnowledgeConfigGateway, PrismaService],
      useFactory: (cfg: IKnowledgeConfigGateway, prisma: PrismaService) =>
        new LightragHttpClient({
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
            return routeLightragConfig(shared, k, ctx);
          },
        }),
    },
  ],
  exports: [ILightragClient],
})
export class LightragModule {}
