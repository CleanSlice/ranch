import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { ReinsController } from './reins.controller';
import { IReinsGateway } from './domain/reins.gateway';
import { ReinsGateway } from './data/reins.gateway';
import { ReinsMapper } from './data/reins.mapper';
import { ReinsService } from './domain/reins.service';
import { ILightragClient } from './data/lightrag.client';
import { LightragHttpClient } from './data/lightragHttp.client';
import { MinioFileLoader } from './data/minio.fileLoader';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [ReinsController],
  providers: [
    ReinsMapper,
    { provide: IReinsGateway, useClass: ReinsGateway },
    {
      provide: MinioFileLoader,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MinioFileLoader({
          endpoint: config.get<string>(
            'MINIO_ENDPOINT',
            'http://localhost:9000',
          ),
          region: config.get<string>('MINIO_REGION', 'us-east-1'),
          accessKeyId: config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
          secretAccessKey: config.get<string>('MINIO_SECRET_KEY', 'minioadmin'),
          bucket: config.get<string>(
            'MINIO_REINS_BUCKET',
            'ranch-reins-sources',
          ),
        }),
    },
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
      provide: ReinsService,
      inject: [IReinsGateway, ILightragClient, MinioFileLoader],
      useFactory: (
        gateway: IReinsGateway,
        client: ILightragClient,
        loader: MinioFileLoader,
      ) => new ReinsService(gateway, client, loader),
    },
  ],
  exports: [ReinsService],
})
export class ReinsModule {}
