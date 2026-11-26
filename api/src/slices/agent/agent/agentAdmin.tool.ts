import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  agentNotFound,
  callerManagesAgents,
  callerParty,
  callerPerson,
  CONFIRM_SENTENCE,
  confirmed,
  manageCaller,
  managesByGrantOnly,
  ok,
  operatorOnly,
  requireOperator,
  requirePerson,
} from '#/mcp/tooling';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAgentGateway } from './domain';
import type { IAgentData } from './domain/agent.types';
import { AgentPermissionService } from './domain/agentPermission.service';
import { toGrantedView } from './domain/agentReaderView';
import { AgentDeployService } from './domain/agentDeploy.service';
import { AgentStatusService } from './domain/agentStatus.service';
import { AgentToolStateService } from './domain/agentToolState.service';
import { detectMcpConfigDrift } from './domain/mcpConfigDrift';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { IPodGateway } from '#/agent/pod/domain';
import { IFileGateway } from '#/agent/file/domain';
import { AgentMcpResolver } from '#/mcpServer/domain/agentMcpResolver.service';
import { IAuthTokenPayload } from '#/user/auth/domain';

/**
 * Env var names whose value never leaves the API through a tool. The console
 * masks a fixed list (`BRIDLE_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `LLM_API_KEY`,
 * `TELEGRAM_BOT_TOKEN` in the Environment tab); a person can click "reveal"
 * there, a model cannot, so the tool masks by name fragment instead — every
 * console entry matches, and so does any credential added later (FR-004).
 */
const SECRET_NAME_FRAGMENTS = ['TOKEN', 'SECRET', 'KEY', 'PASSWORD'];
const MASK = '••••';

function isSecretEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return SECRET_NAME_FRAGMENTS.some((fragment) => upper.includes(fragment));
}

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * The agent lifecycle from the chat (CLEAN-109). `rancher.tool.ts` already
 * lists, creates, updates and restarts agents; this class adds what the
 * console's agent page can do and the operator agent could not: stop and
 * start, delete, and the read-only panels — live status and metrics, the
 * pod environment preview, the MCP servers and their drift, cluster capacity.
 *
 * Every mutation goes through the same services `AgentController` calls, in
 * the same order, so a stop from the chat frees the slot the same way a stop
 * from the console does, and a delete tolerates the same Argo/k8s hiccups.
 *
 * Two audiences (CLEAN-232). The tools that act on ONE agent (stop, start,
 * delete, status, environment, MCP servers) are `manage-agent`: listed for
 * whoever may manage at least one agent, and each call asks
 * `AgentPermissionService` about the agent it names, answering "not found"
 * for one the caller may not manage. Cluster capacity stays with the
 * class's `admin`. Pinning is `person` (CLEAN-231): a pin is the asking
 * person's own, whatever their role, for an agent they reach.
 */
@ToolAudience('admin')
@Injectable()
export class AgentAdminTool implements IConditionallyListedTool {
  private readonly logger = new Logger(AgentAdminTool.name);

  constructor(
    private readonly agents: IAgentGateway,
    private readonly agentDeploy: AgentDeployService,
    private readonly agentStatus: AgentStatusService,
    private readonly pods: IPodGateway,
    private readonly workflows: WorkflowService,
    private readonly files: IFileGateway,
    private readonly mcpResolver: AgentMcpResolver,
    private readonly permission: AgentPermissionService,
    private readonly access: AgentAccessService,
    private readonly pins: IAgentPinGateway,
    private readonly toolState: AgentToolStateService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    // The widest audience in the class; each tool's own audience has already
    // been checked by the time this runs.
    return (
      callerManagesAgents(httpRequest) || callerPerson(httpRequest) !== null
    );
  }

  /** The agent, when it exists and this caller may manage it. */
  private manageable(httpRequest: Request, id: string) {
    return this.permission.manageable(manageCaller(httpRequest), id);
  }

  /**
   * The row a lifecycle tool hands back: whole for whoever manages the agent
   * by role or by having made it, the reader view for a person the assistant
   * setting let in (CLEAN-254).
   */
  private shownTo(
    httpRequest: Request,
    managed: IAgentData,
    row: IAgentData | null,
  ) {
    if (!row) return row;
    return managesByGrantOnly(httpRequest, managed) ? toGrantedView(row) : row;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  @ToolAudience('manage-agent')
  @Tool({
    name: 'stop_agent',
    topic: ToolTopics.Agents,
    effect: 'write',
    title: 'Stop an agent',
    template: 'Stop the agent «name»',
    destructive: true,
    description:
      'Stop an agent without deleting it: cancels its deploy workflow and ' +
      'deletes its pod to free cluster CPU/memory, then marks it "stopped". ' +
      'Its files and settings stay. Use it to free a slot for another agent; ' +
      'bring it back with start_agent. Takes the agent id — resolve a name ' +
      'with list_agents first. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async stopAgent(
    args: { id: string; confirm: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    const agent = await this.manageable(httpRequest, args.id);
    if (!agent) return agentNotFound(httpRequest, args.id);
    const refusal = confirmed(
      args,
      `stop the agent «${agent.name}» and delete its pod`,
    );
    if (refusal) return refusal;
    await this.agentDeploy.stopAgent(args.id);
    const after = await this.agents.findById(args.id);
    return ok({
      ok: true,
      agent: this.shownTo(httpRequest, agent, after),
      message: `Agent «${agent.name}» stopped — its pod is gone and its slot is free. Call start_agent to bring it back.`,
    });
  }

  @ToolAudience('manage-agent')
  @Tool({
    name: 'start_agent',
    topic: ToolTopics.Agents,
    effect: 'write',
    title: 'Start an agent',
    template: 'Start the agent «name»',
    description:
      'Start a stopped agent: deploys a fresh pod and reattaches the ' +
      'runtime. The inverse of stop_agent. The agent shows as "deploying" ' +
      'until its readiness probe passes — check with get_agent_status. ' +
      'Takes the agent id — resolve a name with list_agents first.',
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
    }),
  })
  async startAgent(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    const agent = await this.manageable(httpRequest, id);
    if (!agent) return agentNotFound(httpRequest, id);
    await this.agentDeploy.deploy(id);
    const after = await this.agents.findById(id);
    return ok({
      ok: true,
      agent: this.shownTo(httpRequest, agent, after),
      message: `Agent «${agent.name}» is deploying — it will boot shortly.`,
    });
  }

  @ToolAudience('person')
  @Tool({
    name: 'pin_agent',
    topic: ToolTopics.Agents,
    effect: 'write',
    title: 'Pin or unpin an agent',
    template: 'Pin the agent «name»',
    description:
      'Pin an agent for the person asking, so the consoles keep it at the ' +
      'top of THEIR agent lists, or unpin it with pinned=false. A pin is ' +
      'personal: nobody else\u2019s lists change, and nobody can pin for ' +
      'somebody else. It changes nothing about the agent, its pod, its ' +
      'status or who may use it, and is undone by the same call. Needs a ' +
      'signed-in person and an agent that person can use. Takes the agent ' +
      'id — resolve a name with list_agents first.',
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
      pinned: z.boolean().describe('true to pin, false to unpin'),
    }),
  })
  async pinAgent(
    { id, pinned }: { id: string; pinned: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    // The pin belongs to the person the call is made for (FR-037); an
    // agent acting for itself has no lists to order and is refused.
    const person = requirePerson(httpRequest);
    const agent = await this.agents.findById(id);
    // An agent this person does not reach is an agent that does not exist.
    if (
      !agent ||
      !(await this.access.reaches(callerParty(httpRequest), agent.id))
    ) {
      return agentNotFound(httpRequest, id);
    }
    // Not destructive, so no confirm (docs/agent-tools.md): reversible with
    // the same call and the pod never notices.
    if (pinned) await this.pins.pin(person.userId, agent.id);
    else await this.pins.unpin(person.userId, agent.id);
    return ok({
      ok: true,
      agent: { id: agent.id, name: agent.name, pinned },
      message: pinned
        ? `Agent «${agent.name}» is pinned for you — it stays at the top of your agent lists.`
        : `Agent «${agent.name}» is unpinned for you — back to its ordinary place in your lists.`,
    });
  }

  @ToolAudience('manage-agent')
  @Tool({
    name: 'delete_agent',
    topic: ToolTopics.Agents,
    effect: 'write',
    title: 'Delete an agent',
    template: 'Delete the agent «name» and its workspace',
    destructive: true,
    description:
      'Stop and delete an agent for good: removes its record, cancels its ' +
      'workflow and deletes its pod. Its workspace files in S3 are kept ' +
      'unless wipeS3 is true — say so to the person, since a wipe cannot be ' +
      'undone. Takes the agent id — resolve a name with list_agents first. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
      wipeS3: z
        .boolean()
        .optional()
        .describe(
          'Also delete every workspace file under agents/<id>/ in S3. Off by default.',
        ),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteAgent(
    args: { id: string; wipeS3?: boolean; confirm: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    const { id } = args;
    const agent = await this.manageable(httpRequest, id);
    if (!agent) return agentNotFound(httpRequest, id);
    const refusal = confirmed(
      args,
      args.wipeS3
        ? `delete the agent «${agent.name}» and wipe its workspace files`
        : `delete the agent «${agent.name}» (its workspace files are kept)`,
    );
    if (refusal) return refusal;

    // Same order as AgentController.remove: the row goes first so the list
    // clears at once; a slow or flaky Argo/k8s cleanup must not leave the
    // agent stuck in the console.
    await this.agents.delete(id);

    if (agent.workflowId) {
      try {
        await this.workflows.cancelAgentWorkflow(agent.workflowId);
      } catch (err) {
        this.logger.warn(
          `Cancel workflow failed for agent ${id}: ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.pods.delete(id);
    } catch (err) {
      this.logger.warn(
        `Pod cleanup failed for agent ${id}: ${(err as Error).message}`,
      );
    }

    let wipedFiles: number | null = null;
    if (args.wipeS3 === true) {
      try {
        wipedFiles = await this.files.wipe(id);
        this.logger.log(
          `Wiped ${wipedFiles} S3 object(s) for agent ${id} on delete`,
        );
      } catch (err) {
        this.logger.warn(
          `S3 wipe failed for agent ${id}: ${(err as Error).message}`,
        );
      }
    }

    return ok({
      ok: true,
      agentId: id,
      name: agent.name,
      wipedFiles,
      message:
        `Agent «${agent.name}» deleted.` +
        (args.wipeS3
          ? wipedFiles === null
            ? ' The S3 wipe failed — the workspace files are still there.'
            : ` ${wipedFiles} workspace file(s) wiped.`
          : ' Its workspace files are kept in S3.'),
    });
  }

  // ─── Read-only panels ────────────────────────────────────────────────

  @ToolAudience('manage-agent')
  @Tool({
    name: 'get_agent_status',
    topic: ToolTopics.Agents,
    effect: 'read',
    title: 'Show live status and metrics',
    template: 'How is the agent «name» doing right now?',
    description:
      'Live view of one agent: its status and statusReason, the pod (phase, ' +
      'ready, startedAt, restarts, last termination reason) when one exists, ' +
      'and resource usage — pod CPU/memory against limits, free disk on the ' +
      'node. pod and metrics are null while the agent has no pod (stopped, ' +
      'still pending). tools is what its runtime says about its tool ' +
      'servers, or null when it says nothing: phase "connecting" means it ' +
      'has just started and is still reaching some of them, "limited" that ' +
      'it runs without some; a server in state "retrying" is being tried ' +
      'again on its own, one in state "refused" was turned down for its ' +
      'credentials and needs them fixed, not a wait. Takes the agent id — ' +
      'resolve a name with list_agents.',
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
    }),
  })
  async getAgentStatus(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    const agent = await this.manageable(httpRequest, id);
    if (!agent) return agentNotFound(httpRequest, id);
    // Same sources as GET agents/status (pod list) and GET :id/metrics.
    const [pods, metrics] = await Promise.all([
      this.pods.list(),
      this.pods.getMetrics(id),
    ]);
    const pod = pods.find((p) => p.agentId === id) ?? null;
    // A person the assistant setting let in gets what the status stream
    // gives every signed-in account (`GET agents/status`): is it up, is it
    // ready, how often it restarted. Why it failed, when it was deployed,
    // node metrics and the state of its tool servers are the operator's.
    if (managesByGrantOnly(httpRequest, agent)) {
      return ok({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        pod: pod
          ? {
              phase: pod.phase,
              ready: pod.ready,
              restartCount: pod.restartCount,
              containerWaitingReason: pod.containerWaitingReason,
            }
          : null,
      });
    }
    return ok({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      statusReason: agent.statusReason,
      lastDeployStartedAt: agent.lastDeployStartedAt,
      pod: pod
        ? {
            phase: pod.phase,
            ready: pod.ready,
            startedAt: pod.startedAt,
            restartCount: pod.restartCount,
            terminating: pod.terminating,
            lastTerminationReason: pod.lastTerminationReason,
            containerWaitingReason: pod.containerWaitingReason,
            message: pod.message,
          }
        : null,
      metrics,
      tools: this.toolState.detail(id),
    });
  }

  @ToolAudience('manage-agent')
  @Tool({
    name: 'get_agent_env',
    topic: ToolTopics.Agents,
    effect: 'read',
    title: 'Show the pod environment preview',
    template: 'Show the environment the agent «name» runs with',
    description:
      'The env vars the agent pod receives on its next deploy, built from ' +
      'the same code as the real pod manifest. Values of credentials (names ' +
      'containing TOKEN, SECRET, KEY or PASSWORD) are masked as "••••" — the ' +
      'console can reveal them, a tool cannot. Takes the agent id — resolve ' +
      'a name with list_agents first.',
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
    }),
  })
  async getAgentEnv(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    const agent = await this.manageable(httpRequest, id);
    if (!agent) return agentNotFound(httpRequest, id);
    // Addresses, ids and every setting the pod is started with: an
    // operator's view of the installation, masked credentials or not.
    const refusal = operatorOnly(
      httpRequest,
      agent,
      'The environment an agent’s pod runs with',
    );
    if (refusal) return refusal;
    const env = await this.workflows.previewAgentEnv(agent);
    return ok(
      env.map((v) => ({
        name: v.name,
        value: v.value && isSecretEnvName(v.name) ? MASK : v.value,
        masked: Boolean(v.value) && isSecretEnvName(v.name),
      })),
    );
  }

  @ToolAudience('manage-agent')
  @Tool({
    name: 'list_agent_mcps',
    topic: ToolTopics.Agents,
    effect: 'read',
    title: "Show the agent's MCP servers",
    template:
      'Which MCP servers does the agent «name» have, and does it need a restart?',
    description:
      'The MCP servers this agent gets at runtime — the ones its template ' +
      'attaches plus the always-on built-ins — and whether the running pod ' +
      'still carries that configuration. Servers are baked into the pod at ' +
      'creation, so a change made afterwards only reaches it on a restart: ' +
      'when restartRequired is true, offer restart_agent. Server urls and ' +
      'credentials are not returned; use list_mcp_servers for details. Takes ' +
      'the agent id — resolve a name with list_agents first.',
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
    }),
  })
  async listAgentMcps(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    const agent = await this.manageable(httpRequest, id);
    if (!agent) return agentNotFound(httpRequest, id);
    // Which tool servers the installation has is `list_mcp_servers`, an
    // `admin` tool; this would name them to somebody who cannot list them.
    const refusal = operatorOnly(
      httpRequest,
      agent,
      'The list of tool servers an agent is given',
    );
    if (refusal) return refusal;

    const [servers, pods] = await Promise.all([
      this.mcpResolver.resolveForAgent(agent),
      this.pods.list(),
    ]);
    const pod = pods.find((p) => p.agentId === agent.id) ?? null;

    const drift = detectMcpConfigDrift({
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        updatedAt: s.updatedAt,
      })),
      podStartedAt: pod?.startedAt ? new Date(pod.startedAt) : null,
    });

    return ok({
      agentId: agent.id,
      // No url, no authValue: a model needs the names to reason, not the
      // addresses and credentials the pod authenticates with (FR-004).
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        transport: s.transport,
        enabled: s.enabled,
        builtIn: s.builtIn,
      })),
      drift,
      message: drift.restartRequired
        ? `The pod started before ${drift.changedServers.join(', ')} changed — call restart_agent with id=${agent.id} to apply.`
        : pod
          ? 'The running pod carries exactly this server set.'
          : 'No pod is running; the servers apply on the next deploy.',
    });
  }

  @Tool({
    name: 'get_cluster_capacity',
    topic: ToolTopics.Agents,
    effect: 'read',
    title: 'Show cluster capacity',
    template: 'How much capacity is left for new agents?',
    description:
      'How many more agents fit on the cluster: free schedulable CPU/memory ' +
      'on the agent nodes divided by the fixed per-agent request floor, ' +
      'minus agents still deploying without a pod. Cached about 15 seconds. ' +
      'capacity is null when the Kubernetes API is unreachable — say so ' +
      'rather than guessing a number.',
    parameters: z.object({}),
  })
  async getClusterCapacity(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const capacity = await this.agentStatus.getCapacity();
    if (!capacity) {
      return ok({
        capacity: null,
        message:
          'The Kubernetes API is unreachable right now — capacity is unknown. Try again in a moment.',
      });
    }
    return ok({
      capacity,
      message: `${capacity.freeAgentSlots} of ${capacity.totalAgentSlots} agent slot(s) free.`,
    });
  }
}
