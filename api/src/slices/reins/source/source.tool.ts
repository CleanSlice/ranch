import {
  BadRequestException,
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
import { SourceService } from './domain/source.service';
import { ISourceGateway } from './domain/source.gateway';
import type { ISourceData } from './domain/source.types';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

// The same defaults and ceiling `SourceController.list` / FilterSourcesDto use.
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

const SOURCE_INDEX_STATUSES = [
  'indexed',
  'pending',
  'retrying',
  'failed',
] as const;
const SOURCE_TYPES = ['file', 'url', 'text'] as const;

const SOURCE_NOT_FOUND = (sourceId: string, knowledgeId: string) =>
  ok({
    error:
      `Source ${sourceId} not found in knowledge base ${knowledgeId} — call ` +
      'list_knowledge_sources to find the id, or list_knowledges for the base',
  });

/**
 * The source-level half of the Knowledge section (CLEAN-109): what the
 * console does on a knowledge base's Sources tab, from the chat. The
 * base-level tools (`list_knowledges`, `create_knowledge`, `index_knowledge`,
 * …) live next door in `knowledge/knowledgeAdmin.tool.ts`.
 *
 * Every call goes through `SourceService`, the one thing `SourceController`
 * injects, with the controller's own argument mapping and validation (a url
 * source needs a url, a text source needs text). File and archive uploads
 * stay console-only: they carry bytes from a person's machine, which a chat
 * cannot supply. `add_knowledge_source` covers what an agent can produce —
 * text and URLs.
 *
 * `ISourceGateway` is injected on top of the service for one thing: to read
 * a row before acting on it, so a not-found is reported as a sentence the
 * model can act on and a delete can name what it is about to remove.
 *
 * Operator-only: a plain agent must not be able to feed documents into a
 * base other agents answer from, nor delete what they answer from.
 */
@Injectable()
export class SourceTool implements IConditionallyListedTool {
  private readonly logger = new Logger(SourceTool.name);

  constructor(
    private readonly service: SourceService,
    private readonly sources: ISourceGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  /**
   * The row, or null when it does not exist or belongs to another base. The
   * service checks the same pair itself; this is the friendly version.
   */
  private async resolve(
    knowledgeId: string,
    sourceId: string,
  ): Promise<ISourceData | null> {
    const source = await this.sources.findById(sourceId);
    if (!source || source.knowledgeId !== knowledgeId) return null;
    return source;
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_knowledge_sources',
    topic: ToolTopics.Knowledge,
    title: 'List sources',
    template: 'List the sources of the knowledge base «name»',
    description:
      'List the sources of one knowledge base, one page at a time: each ' +
      'with its id, name, type (file, url or text), index status ' +
      '(indexed, pending, retrying, failed) and any index error. Takes the ' +
      'knowledge id — resolve a name with list_knowledges first. Filter by ' +
      'a name substring, a status or a type to find the rows to reindex or ' +
      'delete. Returns `items`, `total`, `page` and `perPage`.',
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
      page: z.number().int().min(1).optional().describe('Page number, from 1'),
      perPage: z
        .number()
        .int()
        .min(1)
        .max(MAX_PER_PAGE)
        .optional()
        .describe(
          `Rows per page (default ${DEFAULT_PER_PAGE}, max ${MAX_PER_PAGE})`,
        ),
      search: z
        .string()
        .optional()
        .describe('Case-insensitive substring match on the source name'),
      status: z
        .enum(SOURCE_INDEX_STATUSES)
        .optional()
        .describe('Only sources in this index status'),
      type: z
        .enum(SOURCE_TYPES)
        .optional()
        .describe('Only sources of this type'),
    }),
  })
  async listKnowledgeSources(
    args: {
      knowledgeId: string;
      page?: number;
      perPage?: number;
      search?: string;
      status?: (typeof SOURCE_INDEX_STATUSES)[number];
      type?: (typeof SOURCE_TYPES)[number];
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const page = await this.service.findPage(args.knowledgeId, {
      page: args.page ?? DEFAULT_PAGE,
      perPage: args.perPage ?? DEFAULT_PER_PAGE,
      search: args.search,
      status: args.status,
      type: args.type,
    });
    return ok(page);
  }

  @Tool({
    name: 'list_knowledge_imports',
    topic: ToolTopics.Knowledge,
    title: 'Imports in progress',
    template: 'Are any imports running for the knowledge base «name»?',
    description:
      'List the background jobs of one knowledge base: archive imports and ' +
      'text extractions, running and finished within the last hour, each ' +
      'with its status and counts (detected, added, skipped, failed) and ' +
      'the first failures. Takes the knowledge id — resolve a name with ' +
      'list_knowledges first. An empty list means nothing is running and ' +
      'nothing finished recently.',
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
    }),
  })
  async listKnowledgeImports(
    { knowledgeId }: { knowledgeId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return ok(this.service.listImports(knowledgeId));
  }

  // ─── Adding ──────────────────────────────────────────────────────────

  @Tool({
    name: 'add_knowledge_source',
    topic: ToolTopics.Knowledge,
    title: 'Add a URL or text source',
    template: 'Add «url or text» to the knowledge base «name»',
    description:
      'Add one source to a knowledge base: a web page by URL (kind "url") ' +
      'or a piece of text you have (kind "text"), with a display name. ' +
      'Takes the knowledge id — resolve a name with list_knowledges first. ' +
      'Returns the new source row; it is queued, not indexed yet — run ' +
      'index_knowledge on the base (or reindex_knowledge_source on the row) ' +
      'to make it searchable. File and archive uploads stay console-only: ' +
      'ask the person to upload those from the Sources tab.',
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
      kind: z
        .enum(['url', 'text'])
        .describe('What the source is: a web page or text'),
      name: z.string().min(1).describe('Display name for the source'),
      url: z
        .string()
        .url()
        .optional()
        .describe('The page address (kind "url")'),
      text: z.string().optional().describe('The text body (kind "text")'),
    }),
  })
  async addKnowledgeSource(
    args: {
      knowledgeId: string;
      kind: 'url' | 'text';
      name: string;
      url?: string;
      text?: string;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { knowledgeId, kind, name } = args;
    // Same checks as SourceController.add, as tool refusals rather than 400s.
    if (kind === 'url') {
      if (!args.url) return err('url is required when kind is "url"');
      const created = await this.service.addUrl(knowledgeId, {
        name,
        url: args.url,
      });
      this.logger.log(
        `Url source added through MCP: ${created.name} (${created.id})`,
      );
      return ok(created);
    }
    if (!args.text) return err('text is required when kind is "text"');
    const created = await this.service.addText(knowledgeId, {
      name,
      content: args.text,
    });
    this.logger.log(
      `Text source added through MCP: ${created.name} (${created.id})`,
    );
    return ok(created);
  }

  @Tool({
    name: 'add_knowledge_sources_from_sitemap',
    topic: ToolTopics.Knowledge,
    title: 'Add URLs from a sitemap',
    template: 'Add every page of «sitemap url» to the knowledge base «name»',
    description:
      'Fetch a sitemap.xml (or a sitemap index) and add one url source per ' +
      'page it lists, optionally only the pages under a URL prefix. Pages ' +
      'already present as url sources are skipped, so running it twice does ' +
      'not duplicate them. Takes the knowledge id — resolve a name with ' +
      'list_knowledges first. Returns `discovered` (pages in the sitemap) ' +
      'and `added` (new rows). Nothing is indexed yet — run index_knowledge ' +
      'on the base afterwards. A sitemap that cannot be fetched or parsed ' +
      'is reported as an error with the reason.',
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
      sitemapUrl: z
        .string()
        .url()
        .describe('Address of the sitemap.xml or sitemap index'),
      urlPrefix: z
        .string()
        .optional()
        .describe(
          'Only add pages whose URL starts with this, e.g. https://docs.example.com/guide/',
        ),
    }),
  })
  async addKnowledgeSourcesFromSitemap(
    args: { knowledgeId: string; sitemapUrl: string; urlPrefix?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    try {
      const result = await this.service.addFromSitemap(
        args.knowledgeId,
        args.sitemapUrl,
        args.urlPrefix,
      );
      this.logger.log(
        `Sitemap ${args.sitemapUrl} added ${result.added}/${result.discovered} ` +
          `sources to knowledge ${args.knowledgeId} through MCP`,
      );
      return ok(result);
    } catch (e) {
      // The service turns a sitemap fetch/parse failure into a 400; the
      // model needs the reason, not a stack, to tell the person what to fix.
      if (e instanceof BadRequestException) return err(e.message);
      throw e;
    }
  }

  // ─── Per-source actions ──────────────────────────────────────────────

  @Tool({
    name: 'reindex_knowledge_source',
    topic: ToolTopics.Knowledge,
    title: 'Retry one source',
    template: 'Reindex the source «name» in the knowledge base «base»',
    description:
      'Requeue one source and re-ingest it, without touching the rest of ' +
      'the base — for a row whose status reads failed, or whose content ' +
      'changed. Takes the knowledge id and the source id — resolve names ' +
      'with list_knowledges and list_knowledge_sources first. Indexing runs ' +
      'in the background; check the row with list_knowledge_sources later ' +
      '(its indexState goes queued → processing → indexed or failed).',
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
      sourceId: z
        .string()
        .describe('Source id (list_knowledge_sources has them)'),
    }),
  })
  async reindexKnowledgeSource(
    { knowledgeId, sourceId }: { knowledgeId: string; sourceId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const source = await this.resolve(knowledgeId, sourceId);
    if (!source) return SOURCE_NOT_FOUND(sourceId, knowledgeId);
    await this.service.reindexSource(knowledgeId, sourceId);
    return ok({
      ok: true,
      message:
        `Source «${source.name}» requeued for indexing. Check its status ` +
        'with list_knowledge_sources in a moment.',
    });
  }

  @Tool({
    name: 'extract_knowledge_source',
    topic: ToolTopics.Knowledge,
    title: 'Re-extract a scanned PDF',
    template: 'Re-run text extraction for «source» in «base»',
    description:
      'Re-run text extraction for one PDF file source: probes it for a ' +
      'text layer and, if it has none, sends it to OCR in the background. ' +
      'Only PDF file sources qualify; the call says so otherwise. Takes ' +
      'the knowledge id and the source id — resolve names with ' +
      'list_knowledges and list_knowledge_sources first. Progress shows on ' +
      "the row's textState (pending → ready or failed); once it reads " +
      'ready, reindex_knowledge_source makes the text searchable.',
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
      sourceId: z
        .string()
        .describe('Source id (list_knowledge_sources has them)'),
    }),
  })
  async extractKnowledgeSource(
    { knowledgeId, sourceId }: { knowledgeId: string; sourceId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const source = await this.resolve(knowledgeId, sourceId);
    if (!source) return SOURCE_NOT_FOUND(sourceId, knowledgeId);
    try {
      await this.service.reextractSource(knowledgeId, sourceId);
    } catch (e) {
      // "Only PDF file sources can be re-extracted" — a refusal to relay,
      // not a failure.
      if (e instanceof BadRequestException) return err(e.message);
      throw e;
    }
    return ok({
      ok: true,
      message:
        `Text extraction scheduled for «${source.name}». Check its textState ` +
        'with list_knowledge_sources; reindex it once that reads ready.',
    });
  }

  @Tool({
    name: 'delete_knowledge_source',
    topic: ToolTopics.Knowledge,
    title: 'Delete a source',
    template: 'Delete the source «name» from the knowledge base «base»',
    destructive: true,
    description:
      'Delete one source from a knowledge base: its row, its stored file ' +
      'if it has one, and its copy in the retrieval index, so agents stop ' +
      'answering from it. Not reversible — a file source has to be ' +
      'uploaded again from the console. Takes the knowledge id and the ' +
      'source id — resolve names with list_knowledges and ' +
      'list_knowledge_sources first. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      knowledgeId: z
        .string()
        .describe('Knowledge base id (list_knowledges has them)'),
      sourceId: z
        .string()
        .describe('Source id (list_knowledge_sources has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteKnowledgeSource(
    args: { knowledgeId: string; sourceId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { knowledgeId, sourceId } = args;
    const source = await this.resolve(knowledgeId, sourceId);
    if (!source) return SOURCE_NOT_FOUND(sourceId, knowledgeId);

    const refusal = confirmed(
      args,
      `delete the ${source.type} source «${source.name}» from knowledge base ${knowledgeId}`,
    );
    if (refusal) return refusal;

    try {
      await this.service.delete(sourceId);
    } catch (e) {
      // Gone between the read above and the delete: the outcome the person
      // asked for, reported as such.
      if (e instanceof NotFoundException)
        return SOURCE_NOT_FOUND(sourceId, knowledgeId);
      throw e;
    }
    this.logger.log(`Source deleted through MCP: ${source.name} (${sourceId})`);
    return ok({
      deleted: true,
      id: sourceId,
      name: source.name,
      message: `Source «${source.name}» deleted from knowledge base ${knowledgeId}.`,
    });
  }
}
