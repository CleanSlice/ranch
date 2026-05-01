import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';
import { ILightragClient } from './domain/lightrag.client';
import { LightragHttpClient } from './data/lightragHttp.client';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ILightragClient,
      inject: [IKnowledgeConfigGateway],
      useFactory: (cfg: IKnowledgeConfigGateway) =>
        new LightragHttpClient({
          resolveConfig: async () => {
            const c = await cfg.resolve();
            return { url: c.url, apiKey: c.apiKey, enabled: c.enabled };
          },
        }),
    },
  ],
  exports: [ILightragClient],
})
export class LightragModule {}
