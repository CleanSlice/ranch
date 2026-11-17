import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Inject,
  NotFoundException,
  Logger,
  forwardRef,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
  AgentLimitService,
  IAgentLimits,
  ILimitChange,
  ILimitChangeResult,
  resolveLimitChange,
} from '#/agent/limit/domain';
import { limitRuleToHttp } from '#/agent/limit/agentLimit.controller';
import { Observable, map } from 'rxjs';
import { IAgentGateway } from './domain';
import { AgentStatusTypes, IAgentData } from './domain/agent.types';
import { ManagesAgent } from './guards';
import { AgentStatusService } from './domain/agentStatus.service';
import { AgentPermissionService } from './domain/agentPermission.service';
import { toReaderView } from './domain/agentReaderView';
import { AgentDeployService } from './domain/agentDeploy.service';
import { detectMcpConfigDrift } from './domain/mcpConfigDrift';
import {
  AgentCreatorDto,
  AgentDto,
  AgentMcpDto,
  AgentMcpStatusDto,
  AgentEnvVarDto,
  AgentMetricsDto,
  AgentStatusDto,
  ClusterCapacityDto,
  CreateAgentDto,
  UpdateAgentDto,
} from './dtos';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { IWorkflowStatus } from '#/workflow/domain/workflow.types';
import { IPodGateway } from '#/agent/pod/domain';
import { IFileGateway } from '#/agent/file/domain';
import { IBridleGateway } from '#/bridle/domain';
import { AgentMcpResolver } from '#/mcpServer/domain/agentMcpResolver.service';
import {
  heldRoles,
  JwtAuthGuard,
  Public,
  Roles,
  RolesGuard,
  rolesAdmit,
} from '#/user/auth/guards';
import { IUserGateway, UserRoleTypes } from '#/user/user/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';

// Workflow ends as soon as the pod hits phase=Running, but pod=Running does
// not mean the agent inside is ready (channels connected, S3 pulled, HTTP up).
// Keep status at 'deploying' even on Succeeded — AgentStatusService.reconcile
// promotes to 'running' when the readiness probe passes (port 3000 served).
const PHASE_TO_STATUS: Record<IWorkflowStatus['phase'], AgentStatusTypes> = {
  Pending: 'deploying',
  Running: 'deploying',
  Succeeded: 'deploying',
  Failed: 'failed',
  Error: 'failed',
};

/** The console user behind a request, recorded as who changed the limits. */
function subOf(req: Request): string | null {
  const sub = (req as Request & { user?: IAuthTokenPayload }).user?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}

/**
 * The console person creating an agent, for `Agent.createdById`: the `sub` of
 * a person's own token. Never an `agent:` subject; an agent has no account
 * and creates through the `create_agent` tool, for the party it acts for.
 */
function creatorOf(req: Request): string | null {
  const sub = subOf(req);
  return sub && !sub.startsWith('agent:') ? sub : null;
}

/** Owner and Admin are the readers an agent's creator is resolved for. */
function readsCreator(req: Request | undefined): boolean {
  return rolesAdmit(
    [UserRoleTypes.Admin],
    heldRoles(
      (req as (Request & { user?: IAuthTokenPayload }) | undefined)?.user,
    ),
  );
}

/**
 * An agent as a response carries it: without the bare `createdById`, which
 * stays inside the API. `createdBy` is added by `AgentController.present`
 * for the readers it is resolved for and is null for everybody else.
 */
function withoutCreatorId<T extends { createdById?: string | null }>(
  agent: T,
): Omit<T, 'createdById'> {
  const { createdById: _createdById, ...rest } = agent;
  return rest;
}

const ADMIN_AGENT_IS_THE_OWNERS =
  'Only the Owner can make an agent the Ranch admin agent. Create it ' +
  'without that, then ask the Owner to promote it.';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private agentGateway: IAgentGateway,
    private workflowService: WorkflowService,
    private podGateway: IPodGateway,
    private agentStatusService: AgentStatusService,
    private bridleHub: IBridleGateway,
    private fileGateway: IFileGateway,
    private agentDeployService: AgentDeployService,
    private mcpResolver: AgentMcpResolver,
    @Inject(forwardRef(() => AgentLimitService))
    private agentLimits: AgentLimitService,
    private userGateway: IUserGateway,
    private permission: AgentPermissionService,
  ) {}

  private deploy(agentId: string): Promise<void> {
    return this.agentDeployService.deploy(agentId);
  }

  /**
   * Agents as this reader gets them (CLEAN-232). An Owner or Admin sees who
   * created each one: `{ id, name, email }`, with null name and email when
   * the account has been removed, and null when nobody is recorded. A User
   * gets null and nothing to resolve it from: the bare id never leaves.
   *
   * A reader who may not manage an agent gets its reader view
   * (`toReaderView`): no `config`, no credential or knowledge binding, no
   * deploy history. That is every agent for a User who created none, the
   * Ranch admin agent for an Admin, and everything for an anonymous reader.
   */
  private async present(
    agents: IAgentData[],
    req: Request | undefined,
  ): Promise<AgentDto[]> {
    const creators = new Map<string, AgentCreatorDto>();
    if (readsCreator(req)) {
      const ids = [
        ...new Set(
          agents
            .map((a) => a.createdById)
            .filter((id): id is string => typeof id === 'string' && id !== ''),
        ),
      ];
      await Promise.all(
        ids.map(async (id) => {
          const user = await this.userGateway.findById(id).catch(() => null);
          creators.set(id, {
            id,
            name: user?.name ?? null,
            email: user?.email ?? null,
          });
        }),
      );
    }
    const visible = await this.asReadBy(agents, req);
    return visible.map((agent) => ({
      ...withoutCreatorId(agent),
      createdBy: agent.createdById
        ? (creators.get(agent.createdById) ?? null)
        : null,
    }));
  }

  /** Each agent whole for a reader who may manage it, its reader view otherwise. */
  private async asReadBy(
    agents: IAgentData[],
    req: Request | undefined,
  ): Promise<IAgentData[]> {
    const caller = AgentPermissionService.callerOfBearer(
      (req as (Request & { user?: IAuthTokenPayload }) | undefined)?.user,
    );
    return Promise.all(
      agents.map(async (agent) =>
        (await this.permission.canManage(caller, agent))
          ? agent
          : toReaderView(agent),
      ),
    );
  }

  /** The agents of a list the caller may manage, in the order given. */
  private async manageableOf(
    agents: IAgentData[],
    req: Request | undefined,
  ): Promise<IAgentData[]> {
    const caller = AgentPermissionService.callerOfBearer(
      (req as (Request & { user?: IAuthTokenPayload }) | undefined)?.user,
    );
    const allowed = await Promise.all(
      agents.map((agent) => this.permission.canManage(caller, agent)),
    );
    return agents.filter((_, i) => allowed[i]);
  }

  private async presentOne(
    agent: IAgentData | null,
    req: Request | undefined,
  ): Promise<AgentDto | null> {
    return agent ? (await this.present([agent], req))[0] : null;
  }

  private async syncStatus(agentId: string) {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent?.workflowId) return agent;
    // A stopped agent intentionally has no live pod — never resurrect its
    // status from the (now cancelled) workflow phase.
    if (agent.status === 'stopped') return agent;
    // Forward-only: only flip to 'failed' (terminal) here. We never demote
    // 'running' back to 'deploying' on a Pending workflow phase — pod-event
    // reconciler owns the running/deploying transitions and a workflow can
    // briefly look Pending while a pod is already up.
    try {
      const { phase } = await this.workflowService.getWorkflowStatus(
        agent.workflowId,
      );
      const mapped = PHASE_TO_STATUS[phase];
      // This can only ever be the CURRENT workflow: restart detaches the old
      // workflow id before cancelling it and stop clears it, so a terminal
      // phase here is a definitive failure of the in-flight deploy — not a
      // stale echo of a cancelled run.
      //
      // Bridle-truth wins (same rule as the drift sweep): if the runtime is
      // actively connected to the chat hub, the agent IS up no matter what
      // the workflow record claims — writing 'failed' here would ping-pong
      // the status against the reconciler's 'running' on every poll.
      if (
        mapped === 'failed' &&
        agent.status !== 'failed' &&
        !this.bridleHub.isAgentConnected(agentId)
      ) {
        await this.agentGateway.updateStatus(
          agentId,
          'failed',
          agent.workflowId,
          `deploy workflow ${phase.toLowerCase()}`,
        );
        // Only the caller of this GET would learn about the flip otherwise —
        // push it to every open status stream (lists, other operators).
        this.agentStatusService.notifyStatusChanged(agentId);
        return this.agentGateway.findById(agentId);
      }
    } catch {
      // ignore transient workflow fetch errors
    }
    return agent;
  }

  @Get()
  @Roles(UserRoleTypes.User)
  @ApiOperation({
    summary:
      'List all agents. Any signed-in account. An agent the reader may manage comes with its full configuration; any other comes as a reader sees it: `config` empty, `llmCredentialId`, `workflowId`, `statusReason`, `launchContext` and the deploy and sync dates null, `knowledgeIds` empty, `debugEnabled` false (CLEAN-232). `createdBy` is resolved for an Owner or Admin only. The login-free landing page reads GET /agents/public instead (CLEAN-177).',
  })
  @ApiOkResponse({ type: AgentDto, isArray: true })
  async findAll(@Req() req?: Request) {
    return this.present(await this.agentGateway.findAll(), req);
  }

  @Get('public')
  @Public()
  @ApiOperation({
    summary:
      'List agents flagged as public, each as a reader sees it (no configuration, see GET /agents). Used by the marketing landing page so private agents stay hidden from unauthenticated visitors.',
  })
  @ApiOkResponse({ type: AgentDto, isArray: true })
  async findPublic() {
    // Anonymous readers: no creator, resolved or bare.
    return this.present(await this.agentGateway.findPublic(), undefined);
  }

  @Get('status')
  @Roles(UserRoleTypes.User)
  @ApiOperation({
    summary:
      'Snapshot of all agents joined with live pod status. Any signed-in account (CLEAN-177); the SSE stream below stays open because EventSource cannot send a token.',
  })
  @ApiOkResponse({ type: AgentStatusDto, isArray: true })
  async status(@Req() req?: Request) {
    // Status carries no creator: the consoles read that from GET /agents.
    // The agent inside is read like any other: whole for a reader who may
    // manage it, its reader view otherwise.
    const snapshot = await this.agentStatusService.snapshot();
    const agents = await this.asReadBy(
      snapshot.map((s) => s.agent),
      req,
    );
    return snapshot.map((s, i) => ({
      ...s,
      agent: withoutCreatorId(agents[i]),
    }));
  }

  @Sse('status/stream')
  @Public()
  @ApiOperation({
    summary:
      'Live SSE stream of agent pod state changes. Public — EventSource cannot send Authorization headers.',
  })
  statusStream(): Observable<MessageEvent> {
    // Anonymous readers: the creator's id is taken off every agent on the way
    // out, in the opening snapshot and in each event.
    return this.agentStatusService.stream$().pipe(
      map((message) => {
        const data =
          message.type === 'snapshot'
            ? {
                ...message,
                payload: message.payload.map((s) => ({
                  ...s,
                  agent: withoutCreatorId(s.agent),
                })),
              }
            : {
                ...message,
                payload: {
                  ...message.payload,
                  status: {
                    ...message.payload.status,
                    agent: withoutCreatorId(message.payload.status.agent),
                  },
                },
              };
        return { data } as MessageEvent;
      }),
    );
  }

  @Get('capacity')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'getClusterCapacity',
    summary:
      'How many more agents fit on the cluster. Free schedulable CPU/memory ' +
      'on node-role=agents nodes divided by the fixed agent request floor ' +
      '(100m / 512Mi), minus agents still deploying without a pod. Cached ' +
      '~15s; null when the Kubernetes API is unreachable. Admin or Owner — ' +
      'the only roles that can act on the number, and the response reveals ' +
      'node topology.',
  })
  @ApiOkResponse({ type: ClusterCapacityDto })
  getClusterCapacity(): Promise<ClusterCapacityDto | null> {
    return this.agentStatusService.getCapacity();
  }

  @Get(':id')
  @Roles(UserRoleTypes.User)
  @ApiOperation({
    summary:
      'Get agent by ID. Any signed-in account (CLEAN-177): the share page reads POST /share/resolve and the chat widget gets name and status from the hub, so nothing anonymous needs this. With its full configuration for a reader who may manage it; as a reader sees it otherwise (see GET /agents). `createdBy` is resolved for an Owner or Admin only.',
  })
  @ApiOkResponse({ type: AgentDto })
  async findById(@Param('id') id: string, @Req() req?: Request) {
    const agent = await this.syncStatus(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.presentOne(agent, req);
  }

  @Get(':id/metrics')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    operationId: 'getAgentMetrics',
    summary:
      'Live resource usage for the agent: pod CPU/memory (from metrics-server) and free disk space on the K8s node hosting the pod (from kubelet stats/summary). Returns null while no pod exists yet.',
  })
  @ApiOkResponse({ type: AgentMetricsDto })
  async getAgentMetrics(
    @Param('id') id: string,
  ): Promise<AgentMetricsDto | null> {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.podGateway.getMetrics(id);
  }

  @Get(':id/env')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    operationId: 'getAgentEnv',
    summary:
      'Env vars the agent pod receives on its next deploy. Built from the same code as the real pod manifest — the source of truth, never a hand-maintained copy. The UI masks secret values for display.',
  })
  @ApiOkResponse({ type: AgentEnvVarDto, isArray: true })
  async getAgentEnv(@Param('id') id: string): Promise<AgentEnvVarDto[]> {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.workflowService.previewAgentEnv(agent);
  }

  @Get(':id/mcps')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin, UserRoleTypes.Agent)
  @ApiOperation({
    operationId: 'getAgentMcps',
    summary:
      "List of MCP servers this agent should connect to at runtime. Resolves the agent's template and returns its enabled MCP attachments. Called by the runtime on boot to populate its tool registry. Tokens with role=Agent (issued to runtimes) can only read their OWN agent — `sub` must match `agent:<id>`. A person must be able to manage the agent: the Ranch admin agent answers 404 to anybody but the Owner (CLEAN-232).",
  })
  @ApiOkResponse({ type: AgentMcpDto, isArray: true })
  async getMcps(
    @Param('id') id: string,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ): Promise<AgentMcpDto[]> {
    // Self-scope enforcement for agent-issued tokens. The Agent role is only
    // ever attached to JWTs minted by issueAgentServiceToken; the `sub` is
    // `agent:<their-id>`. If the request comes from such a token, the :id
    // param MUST match — otherwise an agent could enumerate its peers' MCPs
    // (and their auth values).
    const sub = req.user?.sub ?? '';
    if (sub.startsWith('agent:') && sub !== `agent:${id}`) {
      throw new ForbiddenException(
        'Agent tokens can only fetch their own MCP list',
      );
    }

    // A person reads it through the manage rule, like the env route next to
    // it: the list carries the servers' auth values, and the Ranch admin
    // agent's are the Owner's (CLEAN-232). `@ManagesAgent` cannot say this,
    // because the guard reads an agent's token as a guest and the runtime
    // reading its own list has to keep working. Same 404 for "no such
    // agent" and "not yours".
    const agent = sub.startsWith('agent:')
      ? await this.agentGateway.findById(id)
      : await this.permission.manageable(
          AgentPermissionService.callerOfBearer(req.user),
          id,
        );
    if (!agent) throw new NotFoundException('Agent not found');

    const enabledServers = await this.mcpResolver.resolveForAgent(agent);

    return enabledServers.map((s) => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      url: s.url,
      authType: s.authType,
      authValue: s.authValue,
      enabled: true,
    }));
  }

  @Get(':id/mcp-status')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    operationId: 'getAgentMcpStatus',
    summary:
      "Whether the running pod still carries the MCP configuration it booted with. An agent's servers are baked into pod env at creation, so a change made afterwards only reaches it on a restart — and until now nothing reported the gap: an unreachable server logs `connect failed`, but one the pod was never told about logs nothing at all.",
  })
  @ApiOkResponse({ type: AgentMcpStatusDto })
  async getMcpStatus(@Param('id') id: string): Promise<AgentMcpStatusDto> {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    const [servers, pods] = await Promise.all([
      this.mcpResolver.resolveForAgent(agent),
      this.podGateway.list(),
    ]);
    const pod = pods.find((p) => p.agentId === agent.id) ?? null;

    return detectMcpConfigDrift({
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        updatedAt: s.updatedAt,
      })),
      podStartedAt: pod?.startedAt ? new Date(pod.startedAt) : null,
    });
  }

  @Post()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Create and deploy a new agent. Admin or Owner.' })
  async create(@Body() dto: CreateAgentDto, @Req() req: Request) {
    // Limits are not an agent column (see agentLimit.prisma), so they are
    // taken out of the payload and saved next to it. Checked BEFORE anything
    // is created: an agent born public needs its limit in the same request.
    const { limits, ...data } = dto;
    // Making an agent the Ranch admin agent hands it Owner power, so it is
    // the Owner's decision here as on POST :id/promote-admin (CLEAN-232).
    if (
      dto.isAdmin === true &&
      !rolesAdmit(
        [UserRoleTypes.Owner],
        heldRoles((req as Request & { user?: IAuthTokenPayload }).user),
      )
    ) {
      throw new ForbiddenException(ADMIN_AGENT_IS_THE_OWNERS);
    }
    const change = this.resolveLimits(
      { isPublic: false, limits: null },
      { isPublic: dto.isPublic, limits },
    );
    // Full sequence (seed → skills → promote-before-deploy → deploy) lives in
    // AgentDeployService.createAgent, shared with the rancher create_agent tool.
    // The creator is the console person behind this request; it is written
    // once, here, and no update carries it.
    const agent = await this.agentDeployService.createAgent(
      { ...data, createdById: creatorOf(req) },
      { isAdmin: dto.isAdmin },
    );
    if (agent && change.limitsTouched) {
      await this.agentLimits.setLimits(agent.id, change.limits, subOf(req));
    }
    return this.presentOne(agent, req);
  }

  /** The visibility rule, as the 400 the console maps to a sentence by `code`. */
  private resolveLimits(
    current: { isPublic: boolean; limits: IAgentLimits | null },
    change: ILimitChange,
  ): ILimitChangeResult {
    try {
      return resolveLimitChange(current, change);
    } catch (err) {
      return limitRuleToHttp(err);
    }
  }

  @Put(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    summary:
      'Update agent configuration. Admin or Owner; the Ranch admin agent is the Owner’s alone and answers 404 to anybody else.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
    @Req() req: Request,
  ) {
    const { limits, ...data } = dto;
    // "A public agent has at least one limit" is a rule on this save, checked
    // only when the save touches visibility or limits — so an agent that was
    // public before limits existed can still be renamed (CLEAN-224). Limits
    // are written first: in either direction the agent is then never public
    // without one, not even between the two writes.
    if (dto.isPublic !== undefined || limits !== undefined) {
      const current = await this.agentGateway.findById(id);
      if (!current) throw new NotFoundException(`Agent ${id} not found`);
      const change = this.resolveLimits(
        {
          isPublic: current.isPublic,
          limits: this.agentLimits.getLimits(id),
        },
        { isPublic: dto.isPublic, limits },
      );
      if (change.limitsTouched) {
        await this.agentLimits.setLimits(id, change.limits, subOf(req));
      }
    }
    const agent = await this.agentGateway.update(id, data);
    // Debug mode has a live half: when `debugEnabled` is in the payload, push
    // a control event over the bridle WS so a running agent flips its
    // prompt-debug stream immediately — the LOG_LEVEL=debug half still needs
    // the restart the caller is prompted for.
    if (dto.debugEnabled !== undefined) {
      this.bridleHub.setDebug(id, dto.debugEnabled);
    }
    return this.presentOne(agent, req);
  }

  @Get('admin/current')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary: 'Get the agent currently flagged as Ranch admin (or null).',
  })
  async findAdmin(@Req() req?: Request) {
    return this.presentOne(await this.agentGateway.findAdmin(), req);
  }

  @Post(':id/promote-admin')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({
    summary:
      'Mark this agent as the Ranch admin. Owner only: the Ranch admin agent holds Owner power, so who it is is the Owner’s decision. Clears the flag from any other agent (single-admin invariant) and redeploys with RANCH_ADMIN=true + a service token. Any previous admin is redeployed without the flag.',
  })
  async promoteAdmin(@Param('id') id: string, @Req() req?: Request) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    const previous = await this.agentGateway.findAdmin();
    await this.agentGateway.setAdmin(id, true);
    if (previous && previous.id !== id) {
      await this.agentDeployService.detachAndCancelWorkflow(
        previous.id,
        previous.workflowId,
      );
      await this.deploy(previous.id);
    }
    await this.agentDeployService.detachAndCancelWorkflow(id, agent.workflowId);
    await this.deploy(id);
    return this.presentOne(await this.agentGateway.findById(id), req);
  }

  @Delete(':id/promote-admin')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({
    summary:
      'Demote this agent from Ranch admin. Owner only. Redeploys without RANCH_ADMIN.',
  })
  async demoteAdmin(@Param('id') id: string, @Req() req?: Request) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.agentGateway.setAdmin(id, false);
    await this.agentDeployService.detachAndCancelWorkflow(id, agent.workflowId);
    await this.deploy(id);
    return this.presentOne(await this.agentGateway.findById(id), req);
  }

  @Post(':id/restart')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({ summary: 'Restart an agent. Admin or Owner.' })
  async restart(@Param('id') id: string, @Req() req?: Request) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.agentDeployService.restartAgent(id);
    return this.presentOne(await this.agentGateway.findById(id), req);
  }

  @Post(':id/stop')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    summary:
      'Stop an agent without deleting it: cancels its workflow and deletes its pod to free cluster CPU/memory, then marks it `stopped`. Use this to free a slot so another agent can start. Bring it back with POST :id/start. Admin or Owner.',
  })
  async stop(@Param('id') id: string, @Req() req?: Request) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.agentDeployService.stopAgent(id);
    return this.presentOne(await this.agentGateway.findById(id), req);
  }

  @Post(':id/start')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    summary:
      'Start a stopped agent: deploys a fresh pod and reattaches the runtime. Inverse of POST :id/stop. Admin or Owner.',
  })
  async start(@Param('id') id: string, @Req() req?: Request) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.deploy(id);
    return this.presentOne(await this.agentGateway.findById(id), req);
  }

  @Post('restart-by-template/:templateId')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'restartByTemplate',
    summary:
      'Restart every agent that uses this template and that the caller may manage. Pulls latest template-owned files into each agent and redeploys, preserving runtime state. Concurrency capped at 5 to avoid overwhelming the cluster. Admin or Owner. An agent the caller may not manage (the Ranch admin agent, for an Admin) is left running and counted in `skipped`, never named; `total` counts the agents that were restarted or failed.',
  })
  async restartByTemplate(
    @Param('templateId') templateId: string,
    @Req() req?: Request,
  ): Promise<{
    restarted: number;
    failed: number;
    total: number;
    skipped: number;
  }> {
    const found = await this.agentGateway.findByTemplateId(templateId);
    // Restarting an agent is managing it (CLEAN-232): an Admin restarting a
    // template must not restart the Ranch admin agent along with it.
    const agents = await this.manageableOf(found, req);
    const skipped = found.length - agents.length;
    if (agents.length === 0) {
      return { restarted: 0, failed: 0, total: 0, skipped };
    }

    const CONCURRENCY = 5;
    let index = 0;
    let restarted = 0;
    let failed = 0;

    const worker = async (): Promise<void> => {
      while (index < agents.length) {
        const a = agents[index++];
        try {
          await this.agentDeployService.restartAgent(a.id);
          restarted += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `Restart-by-template ${templateId}: agent ${a.id} failed — ${(err as Error).message}`,
          );
        }
      }
    };

    const workers = Math.min(CONCURRENCY, agents.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));

    this.logger.log(
      `Restart-by-template ${templateId}: ${restarted} restarted, ${failed} failed of ${agents.length} total, ${skipped} skipped`,
    );

    return { restarted, failed, total: agents.length, skipped };
  }

  @Delete(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ManagesAgent('id')
  @ApiOperation({
    summary:
      'Stop and delete an agent. Pass `?wipeS3=true` to also drop every object under `agents/{id}/` — opt-in so accidental deletes don’t nuke files. Admin or Owner.',
  })
  async remove(@Param('id') id: string, @Query('wipeS3') wipeS3?: string) {
    const agent = await this.agentGateway.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');

    // Delete the DB row first so the UI clears immediately. Argo/k8s can be
    // slow or flaky — we don't want a workflow/pod cleanup hiccup to leave
    // the agent stuck in the list.
    await this.agentGateway.delete(id);

    if (agent.workflowId) {
      try {
        await this.workflowService.cancelAgentWorkflow(agent.workflowId);
      } catch (err) {
        this.logger.warn(
          `Cancel workflow failed for agent ${id}: ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.podGateway.delete(id);
    } catch (err) {
      this.logger.warn(
        `Pod cleanup failed for agent ${id}: ${(err as Error).message}`,
      );
    }

    if (wipeS3 === 'true') {
      try {
        const deleted = await this.fileGateway.wipe(id);
        this.logger.log(
          `Wiped ${deleted} S3 object(s) for agent ${id} on delete`,
        );
      } catch (err) {
        this.logger.warn(
          `S3 wipe failed for agent ${id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
