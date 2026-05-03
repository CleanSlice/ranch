import { Module } from '@nestjs/common';
import { LlmModule } from '#/llm/llm.module';
import { PaddockScenarioController } from './scenario.controller';
import { PaddockScenarioTool } from './scenario.tool';
import { IPaddockScenarioGateway } from './domain/scenario.gateway';
import { IPaddockScenarioGeneratorGateway } from './domain/scenarioGenerator.gateway';
import { PaddockScenarioGateway } from './data/scenario.gateway';
import { PaddockScenarioGeneratorGateway } from './data/scenarioGenerator.gateway';
import { PaddockScenarioMapper } from './data/scenario.mapper';

@Module({
  imports: [LlmModule],
  controllers: [PaddockScenarioController],
  providers: [
    PaddockScenarioMapper,
    PaddockScenarioTool,
    {
      provide: IPaddockScenarioGateway,
      useClass: PaddockScenarioGateway,
    },
    {
      provide: IPaddockScenarioGeneratorGateway,
      useClass: PaddockScenarioGeneratorGateway,
    },
  ],
  exports: [IPaddockScenarioGateway, IPaddockScenarioGeneratorGateway],
})
export class PaddockScenarioModule {}
