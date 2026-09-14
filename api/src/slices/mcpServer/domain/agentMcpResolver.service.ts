import { Injectable } from '@nestjs/common';
import { ITemplateGateway } from '#/agent/template/domain';
import { IKnowledgeGateway } from '#/reins/knowledge/domain';
import { IKnowledgeConfigGateway } from '#/reins/config/domain';
import { IMcpServerGateway } from './mcpServer.gateway';
import type { IMcpServerData } from './mcpServer.types';
import {
  CLEANSLICE_MCP_ID,
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
} from './mcpServer.seeder';

export interface IAgentMcpSubject {
  templateId: string;
  /** The agent's own bases; empty falls back to the template's defaults. */
  knowledgeIds: string[];
}

/**
 * The single answer to "which MCP servers does this agent get".
 *
 * It used to be answered twice. `agent.controller.ts` injected Documents and
 * forgot CleanSlice; `argo-workflow.gateway.ts` — the path that actually
 * writes MCP_SERVERS_B64, the env var a pod boots with — injected CleanSlice
 * and forgot Documents. Both carried a byte-identical copy of the knowledge
 * check. Production showed the split exactly: the pod came up with CleanSlice
 * alone while the endpoint answered Documents alone, so `query_attachment`
 * never reached a single agent, no matter what url its row held (CLEAN-87).
 *
 * Two call sites, one function. A gap here is at least a gap in both at once,
 * which is a bug someone will see rather than one that hides.
 */
@Injectable()
export class AgentMcpResolver {
  constructor(
    private templateGateway: ITemplateGateway,
    private mcpServerGateway: IMcpServerGateway,
    private knowledgeGateway: IKnowledgeGateway,
    private knowledgeConfig: IKnowledgeConfigGateway,
  ) {}

  async resolveForAgent(subject: IAgentMcpSubject): Promise<IMcpServerData[]> {
    const template = await this.templateGateway.findById(subject.templateId);

    const baseServers =
      template && template.mcpServerIds.length > 0
        ? await this.mcpServerGateway.findByIds(template.mcpServerIds)
        : [];
    const servers = baseServers.filter((m) => m.enabled);

    // Always-on built-ins. Every agent can be handed a chat attachment, and
    // every agent may be asked about CleanSlice architecture, so neither
    // depends on the template. An operator opts out by disabling the row.
    //
    // A missing template is not a reason to strip these: the endpoint path
    // used to return [] outright, leaving such an agent with no tools at all.
    await this.addBuiltIn(servers, CLEANSLICE_MCP_ID);
    await this.addBuiltIn(servers, DOCUMENTS_MCP_ID);

    const effectiveKnowledgeIds = subject.knowledgeIds.length
      ? subject.knowledgeIds
      : (template?.defaultKnowledgeIds ?? []);

    if (await this.shouldInjectKnowledge(effectiveKnowledgeIds, servers)) {
      await this.addBuiltIn(servers, KNOWLEDGE_MCP_ID);
    }

    return servers;
  }

  /** Append a built-in unless the template already brought it, or it is off. */
  private async addBuiltIn(
    servers: IMcpServerData[],
    id: string,
  ): Promise<void> {
    if (servers.some((m) => m.id === id)) return;
    const row = await this.mcpServerGateway.findById(id);
    if (row?.enabled) servers.push(row);
  }

  /**
   * Knowledge rides along only for an agent that actually has a base: the
   * tool is useless otherwise and its description would mislead the model
   * into offering a search over nothing.
   */
  private async shouldInjectKnowledge(
    effectiveKnowledgeIds: string[],
    alreadyAttached: IMcpServerData[],
  ): Promise<boolean> {
    if (effectiveKnowledgeIds.length === 0) return false;
    if (alreadyAttached.some((m) => m.id === KNOWLEDGE_MCP_ID)) return false;
    if (!(await this.knowledgeConfig.isEnabled())) return false;
    const existing = await this.knowledgeGateway.findExistingByIds(
      effectiveKnowledgeIds,
    );
    return existing.length > 0;
  }
}
