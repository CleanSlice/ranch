import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { AwsModule } from '#/aws/aws.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { SourceController } from './source.controller';
import { SourceService } from './domain/source.service';
import { ISourceGateway } from './domain/source.gateway';
import { SourceGateway } from './data/source.gateway';
import { SourceMapper } from './data/source.mapper';

@Module({
  imports: [PrismaModule, AwsModule, ConfigModule, LightragModule],
  controllers: [SourceController],
  providers: [
    SourceMapper,
    SourceService,
    { provide: ISourceGateway, useClass: SourceGateway },
  ],
  exports: [SourceService, ISourceGateway],
})
export class SourceModule {}
