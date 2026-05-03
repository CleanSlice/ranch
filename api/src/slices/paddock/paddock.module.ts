import { Module } from '@nestjs/common';
import { PaddockScenarioModule } from './scenario/scenario.module';
import { PaddockEvaluationModule } from './evaluation/evaluation.module';

@Module({
  imports: [PaddockScenarioModule, PaddockEvaluationModule],
  exports: [PaddockScenarioModule, PaddockEvaluationModule],
})
export class PaddockModule {}
