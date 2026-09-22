import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { ILlmGateway } from '#/llm/domain';
import { KnowledgeService } from './domain/knowledge.service';
import { IKnowledgeConfigGateway } from '../config/domain/knowledgeConfig.gateway';
import { ILightragClient } from '../lightrag/domain/lightrag.client';
import { ILightragRuntimeConfig } from '../lightrag/domain/lightrag.types';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** Mirrors `FilterKnowledgeDto` / `GetGraphLabelsDto`, so the tool accepts what the route accepts. */
const LIST_DEFAULT_PER_PAGE = 50;
const LIST_MAX_PER_PAGE = 100;
const LABELS_MAX_LIMIT = 200;

const NOT_CONFIGURED =
  'The knowledge service is not configured. Call get_knowledge_status to ' +
  'see what is missing, then set it up in the console under Knowledge.';

/**
 * Managing knowledge bases from the chat, as the console does (CLEAN-109).
 *
 * `knowledge.tool.ts` next door is `query_knowledge`: any agent may ask its
 * bound bases a question. This class is the other half — creating, indexing,
 * inspecting and deleting bases — and it is for Ranch operators only, because
 * a plain agent must never be able to enlarge or empty what it, or another
 * agent, is allowed to read.
 *
 * Every call goes through `KnowledgeService`, the same service
 * `KnowledgeController` calls, and each tool keeps the controller's guard: the
 * service must be configured before anything but the list and the status can
 * answer, exactly as the routes refuse with 503.
 */
@Injectable()
export class KnowledgeAdminTool implements IConditionallyListedTool {
  private readonly logger = new Logger(KnowledgeAdminTool.name);

  constructor(
    private readonly service: KnowledgeService,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
    private readonly lightrag: ILightragClient,
    private readonly llm: ILlmGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_knowledges',
    topic: ToolTopics.Knowledge,
    title: 'List knowledge bases',
    template: 'List the knowledge bases',
    description:
      'Every knowledge base of this Ranch, paged and searchable by name: ' +
      'its id, index status, source counts and size. Call this first to ' +
      'turn a name the person said into the id the other knowledge tools ' +
      'take. Returns an empty page when the knowledge service is not ' +
      'configured.',
    parameters: z.object({
      search: z
        .string()
        .optional()
        .describe('Substring of the name to filter by'),
      page: z.number().int().min(1).optional().describe('1-based. Default 1.'),
      perPage: z
        .number()
        .int()
        .min(1)
        .max(LIST_MAX_PER_PAGE)
        .optional()
        .describe(`Default ${LIST_DEFAULT_PER_PAGE}.`),
    }),
  })
  async listKnowledges(
    {
      search,
      page,
      perPage,
    }: { search?: string; page?: number; perPage?: number },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    if (!(await this.knowledgeConfig.isEnabled())) {
      // The route answers an empty page rather than 503 here, so the console
      // list renders; the tool does the same and says why it is empty.
      return ok({
        items: [],
        total: 0,
        page: 1,
        perPage: perPage ?? LIST_DEFAULT_PER_PAGE,
        note: NOT_CONFIGURED,
      });
    }
    return ok(await this.service.listPage({ search, page, perPage }));
  }

  @Tool({
    name: 'get_knowledge',
    topic: ToolTopics.Knowledge,
    title: 'Show a knowledge base',
    template: 'Show the knowledge base «name»',
    description:
      'One knowledge base in full: name, description, index status as ' +
      'derived from its sources, whether an index run is alive right now, ' +
      'and the state of its retrieval instance. Resolve the name with ' +
      'list_knowledges first.',
    parameters: z.object({
      id: z.string().describe('Knowledge base id (list_knowledges has them)'),
    }),
  })
  async getKnowledge(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return this.whenConfigured(id, async () =>
      ok(await this.service.getWithDerivedStatus(id)),
    );
  }

  @Tool({
    name: 'get_knowledge_overview',
    topic: ToolTopics.Knowledge,
    title: 'Source counts and size',
    template: 'How big is the knowledge base «name» and what is in it?',
    description:
      "A knowledge base's sources in numbers: how many there are, how many " +
      'are indexed, failed for good, being retried or still in the pipeline, ' +
      'the split by type (file, url, text) and the total stored size in ' +
      'bytes. Read this before deciding whether to index or to add sources.',
    parameters: z.object({
      id: z.string().describe('Knowledge base id (list_knowledges has them)'),
    }),
  })
  async getKnowledgeOverview(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return this.whenConfigured(id, async () =>
      ok(await this.service.getOverview(id)),
    );
  }

  @Tool({
    name: 'list_knowledge_graph_labels',
    topic: ToolTopics.Knowledge,
    title: 'Entity labels',
    template: 'Which entity labels does the knowledge base «name» have?',
    description:
      'The entity labels the index extracted from a knowledge base, with a ' +
      'case-insensitive filter and a cap. `total` counts every match and ' +
      '`truncated` says whether the cap cut the list. Empty labels on a ' +
      'base with sources usually means it has not been indexed yet.',
    parameters: z.object({
      id: z.string().describe('Knowledge base id (list_knowledges has them)'),
      search: z
        .string()
        .optional()
        .describe('Case-insensitive substring of the label'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(LABELS_MAX_LIMIT)
        .optional()
        .describe('Default 50.'),
    }),
  })
  async listKnowledgeGraphLabels(
    { id, search, limit }: { id: string; search?: string; limit?: number },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return this.whenConfigured(id, async () =>
      ok(await this.service.getGraphLabels(id, { search, limit })),
    );
  }

  @Tool({
    name: 'get_knowledge_status',
    topic: ToolTopics.Knowledge,
    title: 'Knowledge service status',
    template: 'Is the knowledge service ready?',
    description:
      'Whether the knowledge service can be used and, if not, what is ' +
      'missing: a chat and an embedding credential, the service URL, the ' +
      'storage bucket, a chat credential selected for it, and whether the ' +
      'retrieval service answers its health check. `runtime` is what the ' +
      'running retrieval service reports about its own models. Read this ' +
      'when any knowledge tool says the service is not configured.',
    parameters: z.object({}),
  })
  async getKnowledgeStatus(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const [config, selected, hasChat, hasEmbedding] = await Promise.all([
      this.knowledgeConfig.resolve(),
      this.knowledgeConfig.getSelectedCredentialIds(),
      this.llm.hasCredentialWithCapability('chat'),
      this.llm.hasCredentialWithCapability('embedding'),
    ]);

    let isHealthy = false;
    let runtime: ILightragRuntimeConfig | null = null;
    if (config.url.length > 0) {
      try {
        const health = await this.lightrag.health();
        isHealthy = health.ok;
        runtime = health.configuration;
      } catch {
        isHealthy = false;
      }
    }

    // Same shape as GET knowledges/status. `config` itself never leaves this
    // method: it carries the service api key.
    return ok({
      enabled: config.enabled,
      setup: {
        hasChatCredential: hasChat,
        hasEmbeddingCredential: hasEmbedding,
        hasUrl: config.url.length > 0,
        hasBucket: config.bucket.length > 0,
        hasCredentialsSelected: selected.chat !== null,
        isHealthy,
      },
      runtime,
    });
  }

  // ─── Changing ────────────────────────────────────────────────────────

  @Tool({
    name: 'create_knowledge',
    topic: ToolTopics.Knowledge,
    title: 'Create a knowledge base',
    template: 'Create a knowledge base «name» described as «description»',
    description:
      'Create an empty knowledge base. When per-base retrieval instances ' +
      'are enabled this also provisions its instance, which the result ' +
      'reports under instanceState. Returns the new base with its id; add ' +
      'sources with add_knowledge_source next, then index_knowledge.',
    parameters: z.object({
      name: z.string().min(1),
      description: z
        .string()
        .optional()
        .describe(
          'What the base is for — agents read it to decide when to search',
        ),
    }),
  })
  async createKnowledge(
    { name, description }: { name: string; description?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    if (!(await this.knowledgeConfig.isEnabled())) return err(NOT_CONFIGURED);
    return this.surfacingRefusals(async () => {
      const created = await this.service.create({ name, description });
      this.logger.log(
        `Knowledge base created through MCP: id=${created.id} name=${created.name}`,
      );
      return ok(created);
    });
  }

  @Tool({
    name: 'update_knowledge',
    topic: ToolTopics.Knowledge,
    title: 'Update a knowledge base',
    template: 'Change the knowledge base «name»: «what to change»',
    description:
      'Rename a knowledge base or change its description. Pass only what ' +
      'changes; a null description clears it. Content is not touched — use ' +
      'the source tools for that. Returns the updated base.',
    parameters: z.object({
      id: z.string().describe('Knowledge base id (list_knowledges has them)'),
      name: z.string().min(1).optional(),
      description: z
        .string()
        .nullable()
        .optional()
        .describe('New description; null clears it'),
    }),
  })
  async updateKnowledge(
    {
      id,
      name,
      description,
    }: { id: string; name?: string; description?: string | null },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    if (name === undefined && description === undefined) {
      return err('Nothing to change: pass a name and/or a description.');
    }
    return this.whenConfigured(id, async () =>
      ok(await this.service.update(id, { name, description })),
    );
  }

  @Tool({
    name: 'index_knowledge',
    topic: ToolTopics.Knowledge,
    title: 'Start indexing',
    template: 'Index the knowledge base «name»',
    description:
      'Start an index run over every source of a knowledge base, in the ' +
      'background: sources never processed are ingested and failed ones are ' +
      'retried, so this is also the way to retry a failed run. Returns at ' +
      'once; watch progress with get_knowledge (indexStatus) and ' +
      'get_knowledge_overview (counts). Refused while a run that has not ' +
      'exhausted its time budget is still going.',
    parameters: z.object({
      id: z.string().describe('Knowledge base id (list_knowledges has them)'),
    }),
  })
  async indexKnowledge(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return this.whenConfigured(id, async () => {
      await this.service.startIndex(id);
      this.logger.log(`Index run started through MCP: knowledge=${id}`);
      return ok(
        `Indexing started for knowledge base ${id}. It runs in the ` +
          'background: get_knowledge shows indexStatus and ' +
          'get_knowledge_overview the per-source counts as it progresses.',
      );
    });
  }

  @Tool({
    name: 'delete_knowledge',
    topic: ToolTopics.Knowledge,
    title: 'Delete a knowledge base',
    template: 'Delete the knowledge base «name»',
    destructive: true,
    description:
      'Delete a knowledge base with all of its sources, its index and its ' +
      'retrieval instance. Not reversible: the stored files and the ' +
      'extracted graph are gone. Agents bound to it simply stop finding it ' +
      '— bind them to another base afterwards if they need one. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('Knowledge base id (list_knowledges has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteKnowledge(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { id } = args;
    return this.whenConfigured(id, async () => {
      // Resolved before the confirmation check, so a wrong id is reported as
      // "not found" instead of as a request for confirmation.
      const base = await this.service.get(id);
      const refusal = confirmed(
        args,
        `delete the knowledge base «${base.name}» with its ${base.sourceCount} ` +
          'source(s), its index and its retrieval instance',
      );
      if (refusal) return refusal;
      await this.service.delete(id);
      this.logger.log(
        `Knowledge base deleted through MCP: id=${id} name=${base.name}`,
      );
      return ok(
        `Knowledge base «${base.name}» (${id}) deleted, with its ` +
          `${base.sourceCount} source(s) and its index. Agents that had it ` +
          'bound no longer search it; use update_agent to bind them to ' +
          'another base if they need one.',
      );
    });
  }

  // ─── Plumbing ────────────────────────────────────────────────────────

  /**
   * The controller's `requireEnabled()` plus the two refusals every
   * per-base route can produce: the id does not exist, or the service
   * refuses the operation (already indexing, instance not ready). Both come
   * back as text with the next move; anything else is a real failure and
   * escapes to the MCP layer as before.
   */
  private async whenConfigured(
    id: string,
    run: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    if (!(await this.knowledgeConfig.isEnabled())) return err(NOT_CONFIGURED);
    return this.surfacingRefusals(run, id);
  }

  private async surfacingRefusals(
    run: () => Promise<ToolResult>,
    id?: string,
  ): Promise<ToolResult> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof NotFoundException && id !== undefined) {
        return ok({
          error: `Knowledge base ${id} not found — call list_knowledges to find the id`,
        });
      }
      if (e instanceof HttpException) return err(e.message);
      throw e;
    }
  }
}
