import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAgentGateway } from './domain';
import { AgentDeployService } from './domain/agentDeploy.service';
import { AgentStatusService } from './domain/agentStatus.service';
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

const notFound = (id: string) =>
  ok({ error: `Agent ${id} not found — call list_agents to find the id` });

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
 * Operator-only: hidden from a plain agent's tools/list, and refused by name.
 */
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
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return callerIsOperator(httpRequest);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  @Tool({
    name: 'stop_agent',
    topic: ToolTopics.Agents,
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
    requireOperator(httpRequest);
    const agent = await this.agents.findById(args.id);
    if (!agent) return notFound(args.id);
    const refusal = confirmed(
      args,
      `stop the agent «${agent.name}» and delete its pod`,
    );
    if (refusal) return refusal;
    await this.agentDeploy.stopAgent(args.id);
    const after = await this.agents.findById(args.id);
    return ok({
      ok: true,
      agent: after,
      message: `Agent «${agent.name}» stopped — its pod is gone and its slot is free. Call start_agent to bring it back.`,
    });
  }

  @Tool({
    name: 'start_agent',
    topic: ToolTopics.Agents,
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
    requireOperator(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return notFound(id);
    await this.agentDeploy.deploy(id);
    const after = await this.agents.findById(id);
    return ok({
      ok: true,
      agent: after,
      message: `Agent «${agent.name}» is deploying — it will boot shortly.`,
    });
  }

  @Tool({
    name: 'delete_agent',
    topic: ToolTopics.Agents,
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
    requireOperator(httpRequest);
    const { id } = args;
    const agent = await this.agents.findById(id);
    if (!agent) return notFound(id);
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

  @Tool({
    name: 'get_agent_status',
    topic: ToolTopics.Agents,
    title: 'Show live status and metrics',
    template: 'How is the agent «name» doing right now?',
    description:
      'Live view of one agent: its status and statusReason, the pod (phase, ' +
      'ready, startedAt, restarts, last termination reason) when one exists, ' +
      'and resource usage — pod CPU/memory against limits, free disk on the ' +
      'node. pod and metrics are null while the agent has no pod (stopped, ' +
      'still pending). Takes the agent id — resolve a name with list_agents.',
    parameters: z.object({
      id: z.string().describe('Agent id — pick from list_agents'),
    }),
  })
  async getAgentStatus(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ) {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return notFound(id);
    // Same sources as GET agents/status (pod list) and GET :id/metrics.
    const [pods, metrics] = await Promise.all([
      this.pods.list(),
      this.pods.getMetrics(id),
    ]);
    const pod = pods.find((p) => p.agentId === id) ?? null;
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
    });
  }

  @Tool({
    name: 'get_agent_env',
    topic: ToolTopics.Agents,
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
    requireOperator(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return notFound(id);
    const env = await this.workflows.previewAgentEnv(agent);
    return ok(
      env.map((v) => ({
        name: v.name,
        value: v.value && isSecretEnvName(v.name) ? MASK : v.value,
        masked: Boolean(v.value) && isSecretEnvName(v.name),
      })),
    );
  }

  @Tool({
    name: 'list_agent_mcps',
    topic: ToolTopics.Agents,
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
    requireOperator(httpRequest);
    const agent = await this.agents.findById(id);
    if (!agent) return notFound(id);

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
