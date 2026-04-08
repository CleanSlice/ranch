import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { IAgentGateway } from './domain/agent.gateway';
import { AgentGateway } from './data/agent.gateway';
import { AgentMapper } from './data/agent.mapper';
import { WorkflowModule } from '#/workflow/workflow.module';

@Module({
  imports: [WorkflowModule],
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
