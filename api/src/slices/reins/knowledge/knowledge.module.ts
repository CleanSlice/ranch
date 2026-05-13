import { Module } from '@nestjs/common';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { LlmModule } from '#/llm/llm.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { ConfigModule } from '../config/config.module';
import { LightragModule } from '../lightrag/lightrag.module';
import { SourceModule } from '../source/source.module';
import { KnowledgeController } from './knowledge.controller';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { KnowledgeService } from './domain/knowledge.service';
import { KnowledgeGateway } from './data/knowledge.gateway';
import { KnowledgeMapper } from './data/knowledge.mapper';
import { KnowledgeTool } from './knowledge.tool';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    LightragModule,
    SourceModule,
    LlmModule,
    AgentModule,
    TemplateModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeMapper,
    KnowledgeService,
    { provide: IKnowledgeGateway, useClass: KnowledgeGateway },
    KnowledgeTool,
  ],
  exports: [IKnowledgeGateway, KnowledgeService],
})
export class KnowledgeModule {}
