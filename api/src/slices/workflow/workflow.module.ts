import { Module, forwardRef } from '@nestjs/common';
import { WorkflowService } from './domain/workflow.service';
import { IWorkflowGateway } from './domain/IWorkflowGateway';
import { ArgoWorkflowGateway } from './data/argo-workflow.gateway';
import { MockWorkflowGateway } from './data/mock-workflow.gateway';
import { RouterWorkflowGateway } from './data/router-workflow.gateway';
import { SettingModule } from '#/setting/setting.module';
import { LlmModule } from '#/llm/llm.module';
import { TemplateModule } from '#/agent/template/template.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { ConfigModule as KnowledgeConfigModule } from '#/reins/config/config.module';
import { AgentChannelModule } from '#/agent/agentChannel/agentChannel.module';
import { UserModule } from '#/user/user/user.module';

// AgentChannelModule is forwardRef'd because it ultimately imports
// FileModule, which already participates in the AgentModule ↔ FileModule
// cycle (AgentModule imports WorkflowModule). Without forwardRef the
// cycle re-enters here at boot.
@Module({
  imports: [
    SettingModule,
    LlmModule,
    TemplateModule,
    McpServerModule,
    KnowledgeModule,
    KnowledgeConfigModule,
    forwardRef(() => AgentChannelModule),
    UserModule,
  ],
  providers: [
    WorkflowService,
    ArgoWorkflowGateway,
    MockWorkflowGateway,
    {
      provide: IWorkflowGateway,
      useClass: RouterWorkflowGateway,
    },
  ],
  exports: [WorkflowService, IWorkflowGateway],
})
export class WorkflowModule {}
