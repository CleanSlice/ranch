import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkflowService } from './domain/workflow.service';
import { IWorkflowGateway } from './domain/IWorkflowGateway';
import { ArgoWorkflowGateway } from './data/argo-workflow.gateway';
import { MockWorkflowGateway } from './data/mock-workflow.gateway';
import { SettingModule } from '#/setting/setting.module';

@Module({
  imports: [SettingModule],
  providers: [
    WorkflowService,
    ArgoWorkflowGateway,
    MockWorkflowGateway,
    {
      provide: IWorkflowGateway,
      inject: [ConfigService, ArgoWorkflowGateway, MockWorkflowGateway],
      useFactory: (
        config: ConfigService,
        argo: ArgoWorkflowGateway,
        mock: MockWorkflowGateway,
      ) => {
        const provider = (
          config.get<string>('WORKFLOW_PROVIDER') ?? 'argo'
        ).toLowerCase();
        console.log(`[WorkflowModule] using provider=${provider}`);
        return provider === 'mock' ? mock : argo;
      },
    },
  ],
  exports: [WorkflowService, IWorkflowGateway],
})
export class WorkflowModule {}
