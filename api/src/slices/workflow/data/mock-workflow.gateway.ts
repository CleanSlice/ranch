import { Injectable, Logger } from '@nestjs/common';
import {
  IWorkflowGateway,
  ISubmitWorkflowData,
} from '../domain/IWorkflowGateway';
import { IWorkflowStatus } from '../domain/workflow.types';

@Injectable()
export class MockWorkflowGateway extends IWorkflowGateway {
  private readonly logger = new Logger(MockWorkflowGateway.name);
  private readonly workflows = new Map<string, IWorkflowStatus>();

  async submit(data: ISubmitWorkflowData): Promise<string> {
    const workflowId = `mock-${data.agentId}-${Date.now()}`;
    const now = new Date().toISOString();
    this.workflows.set(workflowId, {
      name: workflowId,
      phase: 'Running',
      startedAt: now,
      finishedAt: null,
    });
    this.logger.log(`[mock] submit → ${workflowId} for agent ${data.agentId}`);
    return workflowId;
  }

  async cancel(workflowId: string): Promise<void> {
    const existing = this.workflows.get(workflowId);
    if (!existing) return;
    this.workflows.set(workflowId, {
      ...existing,
      phase: 'Failed',
      finishedAt: new Date().toISOString(),
    });
    this.logger.log(`[mock] cancel ← ${workflowId}`);
  }

  async getStatus(workflowId: string): Promise<IWorkflowStatus> {
    return (
      this.workflows.get(workflowId) ?? {
        name: workflowId,
        phase: 'Failed',
        startedAt: null,
        finishedAt: null,
      }
    );
  }

  async getLogs(workflowId: string): Promise<string> {
    return `[mock workflow logs for ${workflowId}]\nArgo is not running locally. Set WORKFLOW_PROVIDER=argo and start Argo Workflows to see real logs.\n`;
  }
}
