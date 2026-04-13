import { Module } from '@nestjs/common';
import { WorkflowService } from './domain/workflow.service';
import { IWorkflowGateway } from './domain/IWorkflowGateway';
import { ArgoWorkflowGateway } from './data/argo-workflow.gateway';

@Module({
  providers: [
    WorkflowService,
    {
      provide: IWorkflowGateway,
      useClass: ArgoWorkflowGateway,
    },
  ],
  exports: [WorkflowService, IWorkflowGateway],
})
export class WorkflowModule {}
