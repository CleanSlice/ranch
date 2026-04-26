import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { AwsModule } from '#/aws/aws.module';
import { S3Repository } from '#/aws/s3';
import { ReinsController } from './reins.controller';
import { IReinsGateway } from './domain/reins.gateway';
import { ReinsGateway } from './data/reins.gateway';
import { ReinsMapper } from './data/reins.mapper';
import { ReinsService } from './domain/reins.service';
import { ILightragClient } from './data/repositories/lightrag/lightrag.client';
import { LightragHttpClient } from './data/repositories/lightrag/lightragHttp.client';

@Module({
  imports: [ConfigModule, PrismaModule, AwsModule],
  controllers: [ReinsController],
  providers: [
    ReinsMapper,
    {
      provide: ILightragClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LightragHttpClient({
          baseUrl: config.get<string>('LIGHTRAG_URL', 'http://localhost:9621'),
          apiKey: config.get<string>(
            'LIGHTRAG_API_KEY',
            'dev-secret-change-me',
          ),
        }),
    },
    {
      provide: IReinsGateway,
      inject: [
        PrismaService,
        ReinsMapper,
        ILightragClient,
        S3Repository,
        ConfigService,
      ],
      useFactory: (
        prisma: PrismaService,
        mapper: ReinsMapper,
        lightrag: ILightragClient,
        s3: S3Repository,
        config: ConfigService,
      ) =>
        new ReinsGateway(
          prisma,
          mapper,
          lightrag,
          s3,
          config.get<string>('REINS_S3_BUCKET', 'ranch-reins-sources'),
        ),
    },
    ReinsService,
  ],
  exports: [ReinsService],
})
export class ReinsModule {}
