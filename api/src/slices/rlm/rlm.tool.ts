import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Request } from 'express';
import { Tool } from '#mcp';
import { IDynamicallyDescribedTool } from '#/mcp/interfaces/dynamic-description.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IKnowledgeGateway } from '#/reins/knowledge/domain';
import { RlmService } from './domain/rlm.service';
import { IRlmContextRef } from './domain/rlm.types';

const BASE_DESCRIPTION =
  'Recursively reason over a large context (a whole knowledge base, or a large workspace file/log) that would be too big or too awkward to reason about in a single pass. Slower and more expensive than query_knowledge - use it when a question needs synthesizing information spread across an entire document (e.g. "compare section 3 and section 12", "summarize everything about X across the whole log"), not for simple factual lookups (use query_knowledge for those instead). If the user has explicitly requested deep/RLM analysis for this turn, you MUST call this tool even if you believe you already know the answer.';

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
export class RlmTool implements IDynamicallyDescribedTool {
  private readonly logger = new Logger(RlmTool.name);

  constructor(
    private readonly rlmService: RlmService,
    private readonly knowledgeGateway: IKnowledgeGateway,
  ) {}

  async describeForRequest(
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): Promise<string | null> {
    const agentId = this.extractAgentId(httpRequest);
    if (!agentId) return null;

    const allowedIds = await this.rlmService.resolveAllowedKnowledgeIds(
      agentId,
    );
    const bases =
      allowedIds.length > 0
        ? await this.knowledgeGateway.findExistingByIds(allowedIds)
        : [];

    const lines = [
      BASE_DESCRIPTION,
      '',
      'You can also pass file_paths under this agent\'s own workspace/ directory as context.',
    ];
    if (bases.length > 0) {
      lines.push(
        '',
        'Knowledge bases available as context (you can omit knowledge_ids to use all of them):',
        ...bases.map((b) => `- "${b.name}" (id: ${b.id})`),
      );
    }
    return lines.join('\n');
  }

  @Tool({
    name: 'rlm_query',
    description: BASE_DESCRIPTION,
    parameters: z.object({
      question: z.string().describe('What you need answered or synthesized.'),
      knowledge_ids: z
        .array(z.string())
        .optional()
        .describe(
          'Optional. Omit to use every knowledge base bound to this agent.',
        ),
      file_paths: z
        .array(z.string())
        .optional()
        .describe(
          'Optional. Workspace-relative file paths (must start with "workspace/") to include as context.',
        ),
    }),
  })
  async query(
    {
      question,
      knowledge_ids,
      file_paths,
    }: { question: string; knowledge_ids?: string[]; file_paths?: string[] },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ): Promise<ToolResult> {
    const callerAgentId = this.extractAgentId(httpRequest);
    if (!callerAgentId) {
      return err('rlm_query can only be called by an agent runtime.');
    }

    const allowedIds = await this.rlmService.resolveAllowedKnowledgeIds(
      callerAgentId,
    );
    const targetKnowledgeIds = knowledge_ids ?? allowedIds;

    const contextRefs: IRlmContextRef[] = [
      ...targetKnowledgeIds.map(
        (knowledgeId): IRlmContextRef => ({ type: 'knowledge', knowledgeId }),
      ),
      ...(file_paths ?? []).map(
        (path): IRlmContextRef => ({
          type: 'agentFile',
          agentId: callerAgentId,
          path,
        }),
      ),
    ];

    if (contextRefs.length === 0) {
      return err(
        'No knowledge bases are bound to this agent and no file_paths were given - nothing for rlm_query to read.',
      );
    }

    try {
      const result = await this.rlmService.execute(callerAgentId, {
        question,
        contextRefs,
      });
      if (result.error) return err(result.error);
      return ok(result.answer);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'rlm_query failed';
      this.logger.warn(
        `rlm_query failed for agent=${callerAgentId}: ${message}`,
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
}
