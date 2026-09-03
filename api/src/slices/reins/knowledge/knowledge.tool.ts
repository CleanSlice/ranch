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

// The batching sentence is not stylistic advice: one call spends several
// seconds inside the knowledge service composing an answer, and the service
// serves them concurrently. Measured on a ten-question request, asking one at
// a time took 198s of retrieval where the same ten issued together took 35s.
// Without saying so, models ask sequentially and the user waits for the sum.
const BASE_DESCRIPTION =
  'Search your bound knowledge bases for factual information. MUST be called FIRST, before drafting any response, when the user asks about a topic that could plausibly be covered by your bound knowledge bases (see the list below). Do NOT hedge with phrases like "isn\'t explicitly detailed" or "based on what I know" before calling this tool - drafting an answer first and then querying is a bug, it wastes the user\'s time and produces a confusing two-phase response. When the request contains several independent questions, issue all of those calls in the same turn rather than one after another: they are answered concurrently, so batching turns minutes of waiting into seconds. Prefer this over web_search for anything that could be in user-uploaded content. Returns matched content with citations. The knowledge_id parameter is optional and rarely worth setting: bases are not searched separately, so one call covers everything bound to you.';

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (value: unknown): ToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
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
      // Names resolve from the caller's bound set only — the tool never
      // reads a full base list (FR-004).
      const bases = await this.knowledgeGateway.findExistingByIds(targetIds);
      const nameOf = new Map(bases.map((b) => [b.id, b.name]));

      // Bases still on the shared pool answer from one index: fanning out
      // over them would return N copies of the same answer and pay for N
      // retrievals — the exact defect the pre-isolation code collapsed. So
      // fan out only across bases with their own instance, and ask the
      // shared-pool group once through its first id.
      const doneOf = new Map(
        bases.map((b) => [b.id, b.migrationState === 'done']),
      );
      const migrated = targetIds.filter((id) => doneOf.get(id) === true);
      const sharedPool = targetIds.filter((id) => doneOf.get(id) !== true);
      const queryIds = [...migrated, ...sharedPool.slice(0, 1)];

      // One retrieval per bound base against that base's own instance; each
      // block names the base it came from (FR-006). A base that cannot be
      // reached is named rather than silently narrowing the answer.
      const results = await Promise.all(
        queryIds.map(async (id) => {
          const knowledge_name = nameOf.get(id) ?? null;
          try {
            const r = await this.knowledgeService.query(id, query);
            return { knowledge_id: id, knowledge_name, ...r };
          } catch (e) {
            const message = e instanceof Error ? e.message : 'query failed';
            return {
              knowledge_id: id,
              knowledge_name,
              error: `Knowledge base ${knowledge_name ?? id} could not be reached: ${message}`,
            };
          }
        }),
      );
      return ok(queryIds.length === 1 ? results[0] : { results });
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
