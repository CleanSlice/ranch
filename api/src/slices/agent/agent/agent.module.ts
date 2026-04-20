import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { IAgentGateway } from './domain/agent.gateway';
import { AgentGateway } from './data/agent.gateway';
import { AgentMapper } from './data/agent.mapper';
import { WorkflowModule } from '#/workflow/workflow.module';
import { TemplateModule } from '#/agent/template/template.module';

@Module({
  imports: [WorkflowModule, TemplateModule],
  controllers: [AgentController],
  providers: [
    AgentMapper,
    {
      provide: IAgentGateway,
      useClass: AgentGateway,
    },
  ],
  exports: [IAgentGateway],
})
export class AgentModule {}
