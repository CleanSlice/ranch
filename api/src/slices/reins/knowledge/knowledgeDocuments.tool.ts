import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import { callerAgentId, err, ok, requireAgent } from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { SourceService } from '../source/domain/source.service';
import type { ISourceData, SourceTypes } from '../source/domain/source.types';
import { IKnowledgeGateway } from './domain/knowledge.gateway';
import { boundKnowledgeIds } from './domain/boundKnowledge';
import {
  IDocumentInventory,
  summarizeDocumentNames,
} from './domain/documentInventory';

// The same defaults and ceiling the console's source list uses
// (FilterSourcesDto). 50 names is a readable page for the model; 200 is
// where the result would start competing with the answer for its window.
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

const DESCRIPTION =
  'List the documents of your bound knowledge bases by NAME, with a summary of what the base covers: how many documents carry each year (2026, 26MY) and each product code (CX-5, Mazda3) in their names. Call this when the person asks what documents, models or years you have, whether a document exists ("is there a 2026 CX-50 Spec Deck?"), or which years a model is covered for. It reads names only: to find out what a document says, call query_knowledge. ' +
  'Returns, per knowledge base, `documents` (one page of `{name, type}`, oldest first), `total`, `page`, `per_page`, and `coverage` computed over the whole base, not the page: `years` (documents per year named in the title), `subjects` (product codes found in the names, most frequent first, each with its own years), and `undated` (documents whose name spells no year). `search` is a case-insensitive substring of the name; page through with `page` when `total` exceeds the page. Never list ids or storage paths to the person — only names.';

interface IDocumentRow {
  name: string;
  type: SourceTypes;
}

interface IDocumentsBlock {
  knowledge_id: string;
  knowledge_name: string | null;
  documents: IDocumentRow[];
  total: number;
  page: number;
  per_page: number;
  coverage: IDocumentInventory;
}

interface IDocumentsError {
  knowledge_id: string;
  knowledge_name: string | null;
  error: string;
}

/**
 * The agent-facing half of the source list (CLEAN-198). `list_knowledge_sources`
 * next door in `source/source.tool.ts` is the operator's: it takes any
 * knowledge id, shows index state, ids and ratings, and is hidden from a
 * plain agent. An agent answering a visitor — in the console, through the
 * website widget or on Telegram — needs the opposite: only the bases it is
 * bound to, names only, and the one summary that answers "what do you have".
 *
 * Without it the agent had two bad options: recite the coverage its prompt
 * hard-codes, which goes stale with the next upload, or reach the REST list
 * through the `http` tool with environment placeholders it cannot resolve,
 * which is what the production skill did (2026-10-29).
 *
 * Reads go through `SourceService`, the one thing `SourceController`
 * injects; the bound set comes from the same rule `query_knowledge` uses,
 * so this tool can never name a document from a base its agent was not
 * given.
 */
@Injectable()
export class KnowledgeDocumentsTool implements IConditionallyListedTool {
  private readonly logger = new Logger(KnowledgeDocumentsTool.name);

  constructor(
    private readonly sources: SourceService,
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly knowledgeGateway: IKnowledgeGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerAgentId(httpRequest) !== null);
  }

  @Tool({
    name: 'list_knowledge_documents',
    topic: ToolTopics.Knowledge,
    title: 'List the documents you can read',
    template: 'Which documents do you have about «topic»?',
    description: DESCRIPTION,
    parameters: z.object({
      search: z
        .string()
        .optional()
        .describe(
          'Case-insensitive substring of the document name, e.g. "CX-50" or "Spec Deck". Omit for every document.',
        ),
      knowledge_id: z
        .string()
        .optional()
        .describe(
          'Optional. Omit to list every knowledge base bound to you. Provide only when you already know the specific knowledge base id.',
        ),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Page of names, from 1'),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(MAX_PER_PAGE)
        .optional()
        .describe(
          `Names per page (default ${DEFAULT_PER_PAGE}, max ${MAX_PER_PAGE})`,
        ),
    }),
  })
  async list(
    args: {
      search?: string;
      knowledge_id?: string;
      page?: number;
      per_page?: number;
    },
    _context: unknown,
    httpRequest: Request,
  ) {
    const agentId = requireAgent(httpRequest);

    const allowedIds = await boundKnowledgeIds(
      agentId,
      this.agentGateway,
      this.templateGateway,
    );
    if (allowedIds.length === 0) {
      return err(
        'No knowledge bases are bound to this agent, so there are no documents to list.',
      );
    }
    if (args.knowledge_id && !allowedIds.includes(args.knowledge_id)) {
      return err(
        `Knowledge ${args.knowledge_id} not bound to this agent. Available: ${allowedIds.join(', ')}. Omit knowledge_id to list all of them.`,
      );
    }
    const targetIds = args.knowledge_id ? [args.knowledge_id] : allowedIds;

    // Names resolve from the bound set only — never a full base list.
    const bases = await this.knowledgeGateway.findExistingByIds(targetIds);
    const nameOf = new Map(bases.map((b) => [b.id, b.name]));

    const page = args.page ?? 1;
    const perPage = args.per_page ?? DEFAULT_PER_PAGE;
    const search = args.search?.trim() || undefined;

    const results: Array<IDocumentsBlock | IDocumentsError> = await Promise.all(
      targetIds.map(async (id) => {
        const knowledge_name = nameOf.get(id) ?? null;
        try {
          const [listed, all] = await Promise.all([
            this.sources.findPage(id, {
              page,
              perPage,
              search,
              sort: 'createdAt',
              order: 'asc',
            }),
            this.sources.findByKnowledge(id),
          ]);
          const block: IDocumentsBlock = {
            knowledge_id: id,
            knowledge_name,
            documents: listed.items.map(toRow),
            total: listed.total,
            page: listed.page,
            per_page: listed.perPage,
            coverage: summarizeDocumentNames(all.map((s) => s.name)),
          };
          this.logger.log(
            `list_knowledge_documents agent=${agentId} knowledge=${id} search=${JSON.stringify(search ?? '')} page=${page} listed=${listed.items.length}/${listed.total} base=${all.length}`,
          );
          return block;
        } catch (e) {
          const message = e instanceof Error ? e.message : 'listing failed';
          this.logger.warn(
            `list_knowledge_documents failed for agent=${agentId} knowledge=${id}: ${message}`,
          );
          return {
            knowledge_id: id,
            knowledge_name,
            error: `Knowledge base ${knowledge_name ?? id} could not be listed: ${message}`,
          };
        }
      }),
    );

    return ok(targetIds.length === 1 ? results[0] : { results });
  }
}

/** Name and kind only: no id, no storage url, no index state (CLEAN-198). */
function toRow(source: ISourceData): IDocumentRow {
  return { name: source.name, type: source.type };
}
