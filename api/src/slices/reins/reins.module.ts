import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { AwsModule } from '#/aws/aws.module';
import { S3Repository } from '#/aws/s3';
import { SettingModule } from '#/setting/setting.module';
import { IInfraConfigGateway } from '#/setting/domain';
import { ReinsController } from './reins.controller';
import { IReinsGateway } from './domain/reins.gateway';
import { ReinsGateway } from './data/reins.gateway';
import { ReinsMapper } from './data/reins.mapper';
import { ReinsService } from './domain/reins.service';
import { ILightragClient } from './data/repositories/lightrag/lightrag.client';
import { LightragHttpClient } from './data/repositories/lightrag/lightragHttp.client';

@Module({
  imports: [PrismaModule, AwsModule, SettingModule],
  controllers: [ReinsController],
  providers: [
    ReinsMapper,
    {
      provide: ILightragClient,
      inject: [IInfraConfigGateway],
      useFactory: async (infraConfig: IInfraConfigGateway) =>
        new LightragHttpClient({
          baseUrl: await infraConfig.getLightragUrl(),
          apiKey: await infraConfig.getLightragApiKey(),
        }),
    },
    {
      provide: IReinsGateway,
      inject: [
        PrismaService,
        ReinsMapper,
        ILightragClient,
        S3Repository,
        IInfraConfigGateway,
      ],
      useFactory: async (
        prisma: PrismaService,
        mapper: ReinsMapper,
        lightrag: ILightragClient,
        s3: S3Repository,
        infraConfig: IInfraConfigGateway,
      ) =>
        new ReinsGateway(
          prisma,
          mapper,
          lightrag,
          s3,
          await infraConfig.getReinsBucket(),
        ),
    },
    ReinsService,
  ],
  exports: [ReinsService],
})
export class ReinsModule {}
