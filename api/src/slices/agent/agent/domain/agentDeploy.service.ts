import { Injectable, Logger } from '@nestjs/common';
import { IAgentGateway } from './agent.gateway';
import { IFileGateway } from '#/agent/file/domain';
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
    private readonly fileGateway: IFileGateway,
  ) {}

  // Full restart sequence: pull latest template-owned files, cancel the
  // previous workflow, redeploy. Each step is best-effort — failures are
  // logged but don't abort the next step (the deploy must always run so a
  // partial earlier failure doesn't leave the agent stuck).
  async restartAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;

    try {
      const synced = await this.fileGateway.resyncFromTemplate(
        agentId,
        agent.templateId,
      );
      if (synced > 0) {
        this.logger.log(
          `Resynced ${synced} template file(s) into agent ${agentId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Template resync failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }

    try {
      await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    } catch (err) {
      this.logger.warn(
        `Cancel workflow failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }

    await this.deploy(agentId);
  }

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
