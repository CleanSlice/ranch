import { Module, forwardRef } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { IAgentGateway } from './domain/agent.gateway';
import { AgentStatusService } from './domain/agentStatus.service';
import { AgentGateway } from './data/agent.gateway';
import { AgentMapper } from './data/agent.mapper';
import { WorkflowModule } from '#/workflow/workflow.module';
import { TemplateModule } from '#/agent/template/template.module';
import { PodModule } from '#/agent/pod/pod.module';
import { FileModule } from '#/agent/file/file.module';
import { AuthModule } from '#/user/auth/auth.module';
import { BridleModule } from '#/bridle/bridle.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';

@Module({
  imports: [
    WorkflowModule,
    TemplateModule,
    PodModule,
    forwardRef(() => FileModule),
    AuthModule,
    forwardRef(() => BridleModule),
    McpServerModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentMapper,
    AgentStatusService,
    {
      provide: IAgentGateway,
      useClass: AgentGateway,
    },
  ],
  exports: [IAgentGateway],
})
export class AgentModule {}
