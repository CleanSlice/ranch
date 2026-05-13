import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import { Request } from 'express';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { KnowledgeService } from './domain/knowledge.service';

const ok = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text:
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const err = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

@Injectable()
export class KnowledgeTool {
  private readonly logger = new Logger(KnowledgeTool.name);

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
  ) {}

  @Tool({
    name: 'query_knowledge',
    description:
      'Query a knowledge base bound to this agent. Bases are configured per-template (defaultKnowledgeIds) or per-agent (knowledgeIds override). The caller must pass a knowledge_id from its allowed list.',
    parameters: z.object({
      knowledge_id: z
        .string()
        .describe('Knowledge base id, e.g. knowledge-abc123'),
      query: z.string().describe('Natural-language search query.'),
    }),
  })
  async query(
    { knowledge_id, query }: { knowledge_id: string; query: string },
    _context: unknown,
    httpRequest: Request & { user?: IAuthTokenPayload },
  ) {
    const callerAgentId = this.extractAgentId(httpRequest);
    if (!callerAgentId) {
      return err('query_knowledge can only be called by an agent runtime.');
    }

    const allowedIds = await this.resolveAllowedIds(callerAgentId);
    if (!allowedIds.includes(knowledge_id)) {
      return err(`Knowledge ${knowledge_id} not bound to this agent.`);
    }

    try {
      const result = await this.knowledgeService.query(knowledge_id, query);
      return ok(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Knowledge query failed';
      this.logger.warn(
        `query_knowledge failed for agent=${callerAgentId} knowledge=${knowledge_id}: ${message}`,
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
