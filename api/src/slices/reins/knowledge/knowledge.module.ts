import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { SourceModule } from '../source/source.module';
import { KnowledgeController } from './knowledge.controller';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { KnowledgeService } from './domain/knowledge.service';
import { KnowledgeGateway } from './data/knowledge.gateway';
import { KnowledgeMapper } from './data/knowledge.mapper';

@Module({
  imports: [PrismaModule, ConfigModule, LightragModule, SourceModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeMapper,
    KnowledgeService,
    { provide: IKnowledgeGateway, useClass: KnowledgeGateway },
  ],
  exports: [IKnowledgeGateway, KnowledgeService],
})
export class KnowledgeModule {}
