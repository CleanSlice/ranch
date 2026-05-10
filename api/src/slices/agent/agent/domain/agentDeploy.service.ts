import { Injectable, Logger } from '@nestjs/common';
import { IAgentGateway } from './agent.gateway';
import { ITemplateGateway } from '#/agent/template/domain';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { AuthService } from '#/user/auth/domain';

@Injectable()
export class AgentDeployService {
  private readonly logger = new Logger(AgentDeployService.name);

  constructor(
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly workflowService: WorkflowService,
    private readonly authService: AuthService,
  ) {}

  async deploy(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;
    const template = await this.templateGateway.findById(agent.templateId);
    if (!template) {
      this.logger.error(
        `Template ${agent.templateId} not found for agent ${agentId}`,
      );
      await this.agentGateway.updateStatus(agentId, 'failed');
      return;
    }
    // Mark deploying BEFORE submitting the workflow. Submit + getStatus take
    // seconds — long enough for the pod to come up and AgentStatusService to
    // flip status to 'running'. If we wrote status here after submit we'd
    // overwrite that 'running' with 'deploying' (last-writer-wins race).
    await this.agentGateway.updateStatus(agentId, 'deploying');
    try {
      // Every agent gets a JWT scoped to its own id. Admin agents get Owner
      // (full Ranch control), non-admins get the Agent role (self-only
      // endpoints — needed so the runtime can fetch its MCP list at boot).
      const ranchApiToken = await this.authService.issueAgentServiceToken(
        agent.id,
        agent.isAdmin,
      );
      const workflowId = await this.workflowService.submitAgentWorkflow(
        agent,
        template.image,
        ranchApiToken,
      );
      // Only attach the new workflowId — never touch status post-submit.
      // Reconciler is the single source of truth for 'running'.
      await this.agentGateway.setWorkflowId(agentId, workflowId);
    } catch (err) {
      this.logger.error(
        `Workflow submit failed for agent ${agentId}: ${(err as Error).message}`,
      );
      await this.agentGateway.updateStatus(agentId, 'failed');
    }
  }
}
