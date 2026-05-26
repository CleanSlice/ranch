import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import { Request } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { IDynamicallyDescribedTool } from '#/mcp/interfaces/dynamic-description.interface';
import { KnowledgeService } from './domain/knowledge.service';
import { IKnowledgeGateway } from './domain/knowledge.gateway';

const BASE_DESCRIPTION =
  'Search your bound knowledge bases for factual information. MUST be called FIRST, before drafting any response, when the user asks about a topic that could plausibly be covered by your bound knowledge bases (see the list below). Do NOT hedge with phrases like "isn\'t explicitly detailed" or "based on what I know" before calling this tool - drafting an answer first and then querying is a bug, it wastes the user\'s time and produces a confusing two-phase response. Prefer this over web_search for anything that could be in user-uploaded content. Returns matched content with citations. The knowledge_id parameter is optional - omit it to search across all your bound bases at once.';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (value: unknown): ToolResult => ({
  content: [
    {
      type: 'text',
      text:
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const err = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

@Injectable()
export class KnowledgeTool implements IDynamicallyDescribedTool {
  private readonly logger = new Logger(KnowledgeTool.name);

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly knowledgeGateway: IKnowledgeGateway,
  ) {}

  /**
   * MCP tools/list is invoked per-session at agent startup. Returning a
   * description that lists the bases bound to the calling agent (name +
   * description) gives the LLM enough context to decide when to query
   * without first having to enumerate via a separate tool. Returns null
   * (= use static description) when the caller isn't an agent or has no
   * bound bases.
   */
  async describeForRequest(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): Promise<string | null> {
    const agentId = this.extractAgentId(httpRequest);
    if (!agentId) return null;

    const allowedIds = await this.resolveAllowedIds(agentId);
    if (allowedIds.length === 0) return null;

    const bases = await this.knowledgeGateway.findExistingByIds(allowedIds);
    if (bases.length === 0) return null;

    const lines = bases.map((b) => {
      const description = b.description?.trim();
      return description
        ? `- "${b.name}" (id: ${b.id}) - ${description}`
        : `- "${b.name}" (id: ${b.id})`;
    });
    return [
      BASE_DESCRIPTION,
      '',
      'Knowledge bases bound to this agent (you can omit knowledge_id to search all of them):',
      ...lines,
    ].join('\n');
  }

  @Tool({
    name: 'query_knowledge',
    description: BASE_DESCRIPTION,
    parameters: z.object({
      knowledge_id: z
        .string()
        .optional()
        .describe(
          'Optional. Omit to search all knowledge bases bound to this agent. Provide only when you already know the specific knowledge base id.',
        ),
      query: z.string().describe('Natural-language search query.'),
    }),
  })
  async query(
    { knowledge_id, query }: { knowledge_id?: string; query: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): Promise<ToolResult> {
    const callerAgentId = this.extractAgentId(httpRequest);
    if (!callerAgentId) {
      return err('query_knowledge can only be called by an agent runtime.');
    }

    const allowedIds = await this.resolveAllowedIds(callerAgentId);
    if (allowedIds.length === 0) {
      return err(
        'No knowledge bases are bound to this agent. Skip this tool and try web_search or other sources.',
      );
    }

    if (knowledge_id && !allowedIds.includes(knowledge_id)) {
      return err(
        `Knowledge ${knowledge_id} not bound to this agent. Available: ${allowedIds.join(', ')}. Omit knowledge_id to search all of them.`,
      );
    }

    const targetIds = knowledge_id ? [knowledge_id] : allowedIds;

    try {
      if (targetIds.length === 1) {
        const result = await this.knowledgeService.query(targetIds[0], query);
        return ok(result);
      }
      // Multi-base search: per-base errors are surfaced inline so one broken
      // base doesn't sink the others. LLM sees a `results` array and picks
      // the relevant entry.
      const results = await Promise.all(
        targetIds.map(async (id) => {
          try {
            const r = await this.knowledgeService.query(id, query);
            return { ...r, knowledge_id: id };
          } catch (e) {
            const message = e instanceof Error ? e.message : 'query failed';
            return { knowledge_id: id, error: message };
          }
        }),
      );
      return ok({ results });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Knowledge query failed';
      this.logger.warn(
        `query_knowledge failed for agent=${callerAgentId}: ${message}`,
      );
      return err(message);
    }
  }

  private extractAgentId(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): string | null {
    const sub = httpRequest.user?.sub ?? '';
    if (!sub.startsWith('agent:')) return null;
    return sub.slice('agent:'.length);
  }

  private async resolveAllowedIds(agentId: string): Promise<string[]> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return [];
    if (agent.knowledgeIds.length > 0) return agent.knowledgeIds;
    const template = await this.templateGateway.findById(agent.templateId);
    return template?.defaultKnowledgeIds ?? [];
  }
}
