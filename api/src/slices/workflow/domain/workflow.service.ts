import { Injectable } from '@nestjs/common';
import { IAgentData } from '#/agent/agent/domain';
import { IWorkflowGateway } from './IWorkflowGateway';
import { IAgentEnvVar } from './workflow.types';

@Injectable()
export class WorkflowService {
  constructor(private workflowGateway: IWorkflowGateway) {}

  async submitAgentWorkflow(
    agent: IAgentData,
    image: string,
    ranchApiToken = '',
  ): Promise<string> {
    return this.workflowGateway.submit({
      agentId: agent.id,
      agentName: agent.name,
      templateId: agent.templateId,
      llmCredentialId: agent.llmCredentialId,
      image,
      config: agent.config,
      resources: agent.resources,
      isAdmin: agent.isAdmin,
      debugEnabled: agent.debugEnabled,
      knowledgeIds: agent.knowledgeIds,
      ranchApiToken,
    });
  }

  /**
   * Env vars the agent's pod receives on its next deploy, secrets masked.
   * Built from the same code as the real manifest — used by the admin
   * "Environment" panel so it can't drift. `image`/`ranchApiToken` are
   * deploy-time values, irrelevant to a preview.
   */
  async previewAgentEnv(agent: IAgentData): Promise<IAgentEnvVar[]> {
    return this.workflowGateway.previewEnv({
      agentId: agent.id,
      agentName: agent.name,
      templateId: agent.templateId,
      llmCredentialId: agent.llmCredentialId,
      image: '',
      config: agent.config,
      resources: agent.resources,
      isAdmin: agent.isAdmin,
      debugEnabled: agent.debugEnabled,
      knowledgeIds: agent.knowledgeIds,
      ranchApiToken: '',
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
