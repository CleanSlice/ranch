import { Injectable } from '@nestjs/common';
import { IAgentData } from '#/agent/domain';
import { IWorkflowGateway } from './IWorkflowGateway';

@Injectable()
export class WorkflowService {
  constructor(private workflowGateway: IWorkflowGateway) {}

  async submitAgentWorkflow(agent: IAgentData): Promise<string> {
    return this.workflowGateway.submit({
      agentId: agent.id,
      agentName: agent.name,
      templateId: agent.templateId,
      config: agent.config,
      resources: agent.resources,
    });
  }

  async cancelAgentWorkflow(workflowId: string | null): Promise<void> {
    if (!workflowId) return;
    await this.workflowGateway.cancel(workflowId);
  }

  async getWorkflowStatus(workflowId: string) {
    return this.workflowGateway.getStatus(workflowId);
  }
}
