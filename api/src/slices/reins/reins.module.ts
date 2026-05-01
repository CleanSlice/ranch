import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { AwsModule } from '#/aws/aws.module';
import { S3Repository } from '#/aws/s3';
import { SettingModule } from '#/setting/setting.module';
import { ReinsController } from './reins.controller';
import { IReinsGateway } from './knowledge/domain/reins.gateway';
import { IKnowledgeConfigService } from './config/domain/knowledgeConfig.service';
import { ReinsGateway } from './knowledge/data/reins.gateway';
import { ReinsMapper } from './knowledge/data/reins.mapper';
import { KnowledgeConfigService } from './config/data/knowledgeConfig.service';
import { ReinsService } from './knowledge/domain/reins.service';
import { ILightragClient } from './knowledge/data/repositories/lightrag/lightrag.client';
import { LightragHttpClient } from './knowledge/data/repositories/lightrag/lightragHttp.client';

@Module({
  imports: [ConfigModule, PrismaModule, AwsModule, SettingModule],
  controllers: [ReinsController],
  providers: [
    ReinsMapper,
    {
      provide: IKnowledgeConfigService,
      useClass: KnowledgeConfigService,
    },
    {
      provide: ILightragClient,
      inject: [IKnowledgeConfigService],
      useFactory: (configService: IKnowledgeConfigService) =>
        new LightragHttpClient({
          resolveConfig: async () => {
            const cfg = await configService.resolve();
            return {
              url: cfg.url,
              apiKey: cfg.apiKey,
              enabled: cfg.enabled,
            };
          },
        }),
    },
    {
      provide: IReinsGateway,
      inject: [
        PrismaService,
        ReinsMapper,
        ILightragClient,
        S3Repository,
        IKnowledgeConfigService,
      ],
      useFactory: (
        prisma: PrismaService,
        mapper: ReinsMapper,
        lightrag: ILightragClient,
        s3: S3Repository,
        knowledgeConfig: IKnowledgeConfigService,
      ) => new ReinsGateway(prisma, mapper, lightrag, s3, knowledgeConfig),
    },
    ReinsService,
  ],
  exports: [ReinsService, IKnowledgeConfigService],
})
export class ReinsModule {}
