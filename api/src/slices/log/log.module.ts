import { Module } from '@nestjs/common';
import { LogController } from './log.controller';
import { AgentModule } from '#/agent/agent/agent.module';
import { WorkflowModule } from '#/workflow/workflow.module';

@Module({
  imports: [AgentModule, WorkflowModule],
  controllers: [LogController],
})
export class LogModule {}
