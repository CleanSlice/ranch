import { Module } from '@nestjs/common';
import { WorkflowService } from './domain/workflow.service';
import { IWorkflowGateway } from './domain/IWorkflowGateway';
import { ArgoWorkflowGateway } from './data/argo-workflow.gateway';
import { MockWorkflowGateway } from './data/mock-workflow.gateway';
import { RouterWorkflowGateway } from './data/router-workflow.gateway';
import { SettingModule } from '#/setting/setting.module';
import { LlmModule } from '#/llm/llm.module';
import { TemplateModule } from '#/agent/template/template.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';

@Module({
  imports: [SettingModule, LlmModule, TemplateModule, McpServerModule],
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
