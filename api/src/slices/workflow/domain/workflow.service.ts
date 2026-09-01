import { Injectable } from '@nestjs/common';
import { IAgentData } from '#/agent/agent/domain';
import { ISettingGateway } from '#/setting/domain';
import { IWorkflowGateway } from './IWorkflowGateway';
import { IAgentEnvVar } from './workflow.types';

const REQUIRED_BRIDLE_SETTINGS = ['bridle_url', 'bridle_api_key'] as const;

@Injectable()
export class WorkflowService {
  constructor(
    private workflowGateway: IWorkflowGateway,
    private settingGateway: ISettingGateway,
  ) {}

  /**
   * Deploy-time misconfiguration probe: returns a human-readable warning when
   * a bridle integration setting is empty in the DB, else null. Checks the DB
   * value, NOT the resolved env — the workflow gateway silently falls back to
   * dev defaults, which point at a k3d host that is unreachable in production
   * (the exact failure mode of the 19-hour "running but offline" incident).
   */
  async checkBridleSettings(): Promise<string | null> {
    for (const name of REQUIRED_BRIDLE_SETTINGS) {
      const setting = await this.settingGateway.findByKey('integrations', name);
      const value = typeof setting?.value === 'string' ? setting.value : '';
      if (!value) {
        return `integrations/${name} is not set — the agent pod will start without hub credentials and can never come online; set it at /settings/bridle and restart the agent`;
      }
    }
    return null;
  }

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
