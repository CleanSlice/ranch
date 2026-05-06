import { Module } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { FileModule } from '#/agent/file/file.module';
import { LlmModule } from '#/llm/llm.module';
import { SettingModule } from '#/setting/setting.module';
import { PaddockScenarioModule } from '../scenario/scenario.module';
import { PaddockEvaluationController } from './evaluation.controller';
import { PaddockEvaluationTool } from './evaluation.tool';
import { IPaddockEvaluationGateway } from './domain/evaluation.gateway';
import { IPaddockReportGateway } from './domain/paddockReport.gateway';
import { IPaddockRunner } from './domain/paddockRunner';
import { PaddockEvaluationService } from './domain/evaluation.service';
import { PaddockEvaluationGateway } from './data/evaluation.gateway';
import { PaddockEvaluationMapper } from './data/evaluation.mapper';
import { PaddockReportGateway } from './data/paddockReport.gateway';
import { BunCliPaddockRunner } from './data/paddockRunner';
import { RanchAgentEnvelope } from './data/ranchAgentEnvelope';

@Module({
  imports: [
    AgentModule,
    TemplateModule,
    FileModule,
    LlmModule,
    SettingModule,
    PaddockScenarioModule,
  ],
  controllers: [PaddockEvaluationController],
  providers: [
    PaddockEvaluationMapper,
    RanchAgentEnvelope,
    PaddockEvaluationService,
    PaddockEvaluationTool,
    {
      provide: IPaddockEvaluationGateway,
      useClass: PaddockEvaluationGateway,
    },
    {
      provide: IPaddockReportGateway,
      useClass: PaddockReportGateway,
    },
    {
      provide: IPaddockRunner,
      useClass: BunCliPaddockRunner,
    },
  ],
  exports: [IPaddockEvaluationGateway, PaddockEvaluationService],
})
export class PaddockEvaluationModule {}
