import { Injectable, Logger } from '@nestjs/common';
import { IAgentGateway } from './agent.gateway';
import { IAgentData, ICreateAgentData } from './agent.types';
import { IFileGateway } from '#/agent/file/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { AuthService } from '#/user/auth/domain';
import { ISkillGateway } from '#/skill/domain';
import { IPodGateway } from '#/agent/pod/domain';
import { DeployTracker } from './deployTracker';

@Injectable()
export class AgentDeployService {
  private readonly logger = new Logger(AgentDeployService.name);

  constructor(
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly workflowService: WorkflowService,
    private readonly authService: AuthService,
    private readonly fileGateway: IFileGateway,
    private readonly skillGateway: ISkillGateway,
    private readonly podGateway: IPodGateway,
    private readonly deployTracker: DeployTracker,
  ) {}

  // Full restart sequence: pull latest template-owned files, cancel the
  // previous workflow, redeploy. Each step is best-effort — failures are
  // logged but don't abort the next step (the deploy must always run so a
  // partial earlier failure doesn't leave the agent stuck).
  async restartAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;

    // Mark BEFORE cancel so the old pod's MODIFIED phase=Failed event (emitted
    // by Argo's cancellation) is recognised as stale by the reconciler.
    this.deployTracker.mark(agentId);

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

    await this.syncSkillsFromTemplate(agentId, agent.templateId);

    await this.detachAndCancelWorkflow(agentId, agent.workflowId);

    await this.deploy(agentId);
  }

  // Full creation sequence, shared by the REST controller and the rancher
  // create_agent tool: DB row → template file seed (best-effort) → skills
  // sync → optional admin promotion → first deploy. Promotion happens BEFORE
  // the first deploy so the workflow boots the pod with RANCH_ADMIN=true on
  // the first try — avoids the "create deploys non-admin → promote cancels +
  // redeploys" race where the cancel sometimes doesn't replace the running
  // pod fast enough.
  async createAgent(
    input: ICreateAgentData,
    opts: { isAdmin?: boolean } = {},
  ): Promise<IAgentData | null> {
    const agent = await this.agentGateway.create(input);
    try {
      const copied = await this.fileGateway.seedFromTemplate(
        agent.id,
        agent.templateId,
      );
      if (copied > 0) {
        this.logger.log(
          `Seeded ${copied} files into agent ${agent.id} from template ${agent.templateId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Template seed skipped for agent ${agent.id}: ${(err as Error).message}`,
      );
    }
    await this.syncSkillsFromTemplate(agent.id, agent.templateId);
    if (opts.isAdmin === true) {
      const previous = await this.agentGateway.findAdmin();
      if (previous && previous.id !== agent.id) {
        await this.agentGateway.setAdmin(previous.id, false);
        await this.detachAndCancelWorkflow(previous.id, previous.workflowId);
        await this.deploy(previous.id);
      }
      await this.agentGateway.setAdmin(agent.id, true);
    }
    await this.deploy(agent.id);
    return this.agentGateway.findById(agent.id);
  }

  // Detach the workflow id from the agent row BEFORE cancelling it. A
  // concurrent GET /agents/:id (syncStatus) polls the workflow referenced by
  // the DB row; without this ordering it can catch the just-cancelled
  // workflow in phase=Failed and write a spurious 'failed' between the
  // cancel and the follow-up deploy()'s 'deploying'. Best-effort — callers
  // always deploy() afterwards, which must run regardless.
  async detachAndCancelWorkflow(
    agentId: string,
    workflowId: string | null,
  ): Promise<void> {
    if (!workflowId) return;
    try {
      await this.agentGateway.setWorkflowId(agentId, null);
      await this.workflowService.cancelAgentWorkflow(workflowId);
    } catch (err) {
      this.logger.warn(
        `Cancel workflow failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }
  }

  // Stop a running agent: cancel its workflow and delete the pod so the
  // cluster resources (CPU/memory) are freed, then mark it 'stopped'. The DB
  // row is kept so the agent can be brought back later via deploy(). Unlike
  // restartAgent this does NOT redeploy — that's the whole point: free a slot
  // on the cluster so another agent can start.
  async stopAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;

    // Mark BEFORE cancel so the dying pod's MODIFIED phase=Failed event
    // (emitted by Argo's cancellation) is recognised as stale by the
    // reconciler and doesn't flip the row from 'stopped' to 'failed'.
    this.deployTracker.mark(agentId);

    // Set 'stopped' (and clear the workflow id) up front so the UI reflects
    // the intent immediately and the controller's syncStatus stops polling the
    // about-to-be-cancelled workflow.
    await this.agentGateway.updateStatus(agentId, 'stopped', null);

    try {
      await this.workflowService.cancelAgentWorkflow(agent.workflowId);
    } catch (err) {
      this.logger.warn(
        `Cancel workflow failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }

    try {
      await this.podGateway.delete(agentId);
    } catch (err) {
      this.logger.warn(
        `Pod cleanup failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }
  }

  async deploy(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;
    const template = await this.templateGateway.findById(agent.templateId);
    if (!template) {
      this.logger.error(
        `Template ${agent.templateId} not found for agent ${agentId}`,
      );
      await this.agentGateway.updateStatus(
        agentId,
        'failed',
        undefined,
        `Template ${agent.templateId} not found`,
      );
      return;
    }
    // Idempotent — restartAgent already marked it, but cold deploys (initial
    // create) call deploy() directly without going through restartAgent.
    this.deployTracker.mark(agentId);
    // 'initial' iff this agent has never been deployed — persisted so the UI
    // can tell a first start from a restart even after a page reload.
    const launchContext =
      agent.firstDeployedAt === null ? 'initial' : 'restart';
    // Mark deploying BEFORE submitting the workflow. Submit + getStatus take
    // seconds — long enough for the pod to come up and AgentStatusService to
    // flip status to 'running'. If we wrote status here after submit we'd
    // overwrite that 'running' with 'deploying' (last-writer-wins race).
    // markDeployStarted also stamps lastDeployStartedAt — the anchor of the
    // drift-detection grace window — and clears any stale statusReason.
    await this.agentGateway.markDeployStarted(agentId, launchContext);
    // Deploy-time misconfiguration signal (non-blocking, best-effort): empty
    // bridle settings produce a pod that can never register on the hub, so
    // flag it NOW instead of waiting for the unreachable sweep. The reason
    // survives the whole 'deploying' phase (markDeployStarted just cleared
    // the previous one) and is cleared by the reconciler's promotion.
    try {
      const bridleWarning = await this.workflowService.checkBridleSettings();
      if (bridleWarning) {
        this.logger.warn(`Agent ${agentId}: ${bridleWarning}`);
        await this.agentGateway.setStatusReason(agentId, bridleWarning);
      }
    } catch (err) {
      this.logger.warn(
        `Bridle settings check failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }
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
      await this.agentGateway.setFirstDeployedAt(agentId);
    } catch (err) {
      this.logger.error(
        `Workflow submit failed for agent ${agentId}: ${(err as Error).message}`,
      );
      // Generic on purpose: statusReason is served on public agent endpoints,
      // and raw submit errors can carry internal detail (Argo endpoints,
      // auth specifics). The full message is in the server log above.
      await this.agentGateway.updateStatus(
        agentId,
        'failed',
        undefined,
        'workflow submit failed',
      );
    }
  }

  // Mirror the template's currently-attached skills (from DB) into the
  // agent's S3 prefix as `.agent/skills/<name>/`. Always wipes the prefix
  // first so detached skills disappear too. Best-effort — a failure here
  // shouldn't block deploy / restart.
  async syncSkillsFromTemplate(
    agentId: string,
    templateId: string,
  ): Promise<void> {
    try {
      const template = await this.templateGateway.findById(templateId);
      if (!template) return;
      const skills =
        template.skillIds.length > 0
          ? await this.skillGateway.findByIds(template.skillIds)
          : [];
      const bundles = skills.map((s) => ({
        name: s.name,
        body: s.body,
        files: s.files,
      }));
      const written = await this.fileGateway.syncSkills(agentId, bundles);
      this.logger.log(
        `Synced ${skills.length} skill(s) into agent ${agentId} (${written} file(s) written)`,
      );
    } catch (err) {
      this.logger.warn(
        `Skill sync failed for agent ${agentId}: ${(err as Error).message}`,
      );
    }
  }
}
