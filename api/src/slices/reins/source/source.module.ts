import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { AwsModule } from '#/aws/aws.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { SourceController } from './source.controller';
import { SourceService } from './domain/source.service';
import { ISourceGateway } from './domain/source.gateway';
import { ImportJobRegistry } from './domain/importJob.registry';
import { SourceGateway } from './data/source.gateway';
import { SourceMapper } from './data/source.mapper';
import { SourceTool } from './source.tool';
import { SourceRatingService } from './domain/sourceRating.service';
import { ISourceRatingGateway } from './domain/sourceRating.gateway';
import { SourceRatingGateway } from './data/sourceRating.gateway';
import { ISourceRatingReader } from '#/chat/domain/chatSource.gateway';

@Module({
  imports: [
    PrismaModule,
    AwsModule,
    ConfigModule,
    LightragModule,
    forwardRef(() => ExtractionModule),
  ],
  controllers: [SourceController],
  providers: [
    SourceMapper,
    SourceService,
    SourceTool,
    ImportJobRegistry,
    { provide: ISourceGateway, useClass: SourceGateway },
    // Ratings on a source (CLEAN-138). The chat slice reads a viewer's own
    // verdicts through the ISourceRatingReader token it declared; this is
    // the one provider behind it.
    SourceRatingService,
    { provide: ISourceRatingGateway, useClass: SourceRatingGateway },
    { provide: ISourceRatingReader, useExisting: SourceRatingService },
  ],
  exports: [
    SourceService,
    ISourceGateway,
    ImportJobRegistry,
    SourceRatingService,
    ISourceRatingReader,
  ],
})
export class SourceModule {}
