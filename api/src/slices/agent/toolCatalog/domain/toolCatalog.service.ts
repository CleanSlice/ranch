import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { IAgentGateway } from '#/agent/agent/domain';
import { IPodGateway } from '#/agent/pod/domain';
import { detectMcpConfigDrift } from '#/agent/agent/domain/mcpConfigDrift';
import { AgentMcpResolver } from '#/mcpServer/domain/agentMcpResolver.service';
import {
  CLEANSLICE_MCP_ID,
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import { ToolCatalogService as McpToolCatalogService } from '#/mcp/services/tool-catalog.service';
import { TOOL_TOPIC_INFO, isToolTopic, orderedTopics } from '#/mcp/decorators/topics';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  IAgentToolCatalog,
  IAgentToolEntry,
  IAgentToolGroup,
  IToolListingGateway,
  ToolListingStates,
} from './toolCatalog.types';

/**
 * The built-in servers the API hosts itself (plus the CleanSlice docs
 * server): their tools come from this API's registry, so they are the
 * `builtin` groups of the catalogue. Everything else on the agent's list is
 * an external server the console shows as an opaque group.
 */
export const BUILT_IN_MCP_IDS: readonly string[] = [
  RANCH_MCP_ID,
  KNOWLEDGE_MCP_ID,
  DOCUMENTS_MCP_ID,
  CLEANSLICE_MCP_ID,
];

/**
 * The principal a pod's service token carries — the same shape
 * `issueAgentServiceToken` signs (auth.service): admin agents act as Ranch
 * operators, plain agents hold the Agent role. Listing with it yields exactly
 * what the pod sees.
 */
export function agentPrincipal(agent: {
  id: string;
  isAdmin: boolean;
}): IAuthTokenPayload {
  return {
    sub: `agent:${agent.id}`,
    email: `agent-${agent.id}@ranch.local`,
    roles: agent.isAdmin ? [UserRoleTypes.Owner] : [UserRoleTypes.Agent],
  };
}

@Injectable()
export class ToolCatalogService {
  constructor(
    private readonly agents: IAgentGateway,
    private readonly pods: IPodGateway,
    private readonly mcpResolver: AgentMcpResolver,
    private readonly listing: McpToolCatalogService,
    private readonly listings: IToolListingGateway,
  ) {}

  async forAgent(agentId: string): Promise<IAgentToolCatalog> {
    const agent = await this.agents.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const [tools, snapshot, pods, servers] = await Promise.all([
      this.listing.listFor({
        user: agentPrincipal(agent),
      } as unknown as Request),
      this.listings.findByAgent(agentId),
      this.pods.list(),
      this.mcpResolver.resolveForAgent(agent),
    ]);

    const pod = pods.find((p) => p.agentId === agentId) ?? null;
    const podStartedAt = pod?.startedAt ?? null;

    // A snapshot only speaks for the pod that made it. Right after a restart
    // the new pod is up before it has listed its tools, and the previous
    // pod's snapshot would read as "this pod lacks everything" — a badge that
    // told the person to restart the agent they had just restarted. So a
    // snapshot older than the pod counts as "not listed yet": no badge,
    // and the sheet says the agent is still loading its tools.
    const listingState = listingStateOf(podStartedAt, snapshot?.listedAt ?? null);
    const known =
      listingState === 'fresh' && snapshot ? new Set(snapshot.toolNames) : null;

    const inPodOf = (name: string): boolean | null => {
      // No pod, or no listing from this pod yet: nothing to claim.
      if (!known) return null;
      return known.has(name);
    };

    const byTopic = new Map<string, IAgentToolEntry[]>();
    for (const tool of tools) {
      const topic = isToolTopic(tool.metadata.topic)
        ? tool.metadata.topic
        : 'platform';
      const entries = byTopic.get(topic) ?? [];
      entries.push({
        name: tool.name,
        title: tool.metadata.title,
        description: tool.description,
        template: tool.metadata.template,
        destructive: tool.metadata.destructive === true,
        inPod: inPodOf(tool.name),
      });
      byTopic.set(topic, entries);
    }

    const groups: IAgentToolGroup[] = [];
    for (const topic of orderedTopics()) {
      const entries = byTopic.get(topic.key);
      if (!entries?.length) continue;
      entries.sort((a, b) => a.title.localeCompare(b.title));
      groups.push({
        key: topic.key,
        title: TOOL_TOPIC_INFO[topic.key].title,
        kind: 'builtin',
        afterRestart: entries.some((e) => e.inPod === false),
        tools: entries,
      });
    }

    const external = servers.filter((s) => !BUILT_IN_MCP_IDS.includes(s.id));
    for (const server of external) {
      const drift = detectMcpConfigDrift({
        servers: [
          { id: server.id, name: server.name, updatedAt: server.updatedAt },
        ],
        podStartedAt: podStartedAt ? new Date(podStartedAt) : null,
      });
      groups.push({
        key: `mcp:${server.id}`,
        title: server.name,
        kind: 'external',
        ...(server.description ? { description: server.description } : {}),
        afterRestart: drift.restartRequired,
        tools: [],
      });
    }

    return {
      agentId,
      podStartedAt,
      listedAt: snapshot ? snapshot.listedAt.toISOString() : null,
      listingState,
      groups,
    };
  }
}

/**
 * Container start and the first tools/list are seconds apart in the same
 * direction, but the two clocks (kubelet vs. this API) need not agree to the
 * millisecond; a small slack keeps a legitimate listing from reading as
 * older than its pod.
 */
const CLOCK_SLACK_MS = 10_000;

export function listingStateOf(
  podStartedAt: string | null,
  listedAt: Date | null,
): ToolListingStates {
  if (!podStartedAt) return 'none';
  if (!listedAt) return 'pending';
  const start = new Date(podStartedAt).getTime();
  return listedAt.getTime() + CLOCK_SLACK_MS >= start ? 'fresh' : 'pending';
}
