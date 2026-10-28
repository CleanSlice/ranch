import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ILightragClient } from '../domain/lightrag.client';
import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResult,
  IQueryReference,
  IRetrieveContextInput,
  IContextResult,
  IContextChunk,
  IContextRelation,
  QueryModeTypes,
  ILightragHealth,
  IGetGraphInput,
  ILightragGraph,
  ILightragGraphNode,
  ILightragGraphEdge,
  ITrackStatus,
  IDocumentProcessingStatus,
  DocumentProcessingStatusTypes,
  ILightragRuntimeConfig,
  IDocumentRecord,
  IPipelineStatus,
  LightragClientError,
  LightragTimeoutError,
} from '../domain/lightrag.types';

type FetchImpl = typeof fetch;

/**
 * How long each kind of call may take before LightRAG counts as hung. None of
 * these used to be bounded, so a LightRAG that accepted the connection and
 * never answered held its caller for as long as the socket lived: agents saw
 * the MCP client's own 60 s limit ("MCP error -32001"), and the index
 * reconciler, which awaits these inside its lock, would never run again.
 * The query limit sits under that 60 s on purpose, so the agent gets a
 * sentence from the tool instead of a transport error.
 */
const HEALTH_TIMEOUT_MS = 2_000;
const READ_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 50_000;
const GRAPH_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 120_000;
// Deleting a large document recomputes the descriptions of every entity it
// touched; minutes are normal.
const DELETE_TIMEOUT_MS = 300_000;

/**
 * Retrieval without generation (CLEAN-184). The 50 s above paid for the
 * model writing an answer; what is left is the keyword step in graph modes
 * plus the vector and graph reads — the same class of work as the 30 s
 * status reads, measured at 0.7–6 s on the reference base. Stays under the
 * MCP client's 60 s so the tool answers in words, not with a transport error.
 */
const CONTEXT_TIMEOUT_MS = 30_000;

/**
 * `naive`: vector top-k over the chunks, no keyword-extraction model call,
 * no graph walk. Measured 2026-10-28 on the Mazda base against LightRAG
 * 1.4.16: 0.7–1.5 s, where `mix` took 3–6 s and 21.7 s on the hub question
 * "what is Mazda" (the fork had already moved off `hybrid` for the same
 * reason), and no mode retrieved more of the right document for the natural
 * question (specs/023-knowledge-context-retrieval/research.md, F11, F13,
 * D2). Graph modes stay reachable through `mode`.
 */
export const CONTEXT_QUERY_MODE: QueryModeTypes = 'naive';

/**
 * Twelve ~4 600-character chunks are about twice the tool's budget: enough
 * that the fitting decides by relevance rather than the server by count,
 * not so many that the instance ships 50 000 characters that are thrown
 * away. Twenty entities and relations: the tool keeps at most eight facts.
 */
const CONTEXT_CHUNK_TOP_K = 12;
const CONTEXT_TOP_K = 20;

export interface LightragRequestConfig {
  url: string;
  apiKey: string;
  enabled: boolean;
}

/**
 * Which base a call belongs to and whether it reads or writes. The resolver
 * (wired in lightrag.module.ts) owns the routing policy: a migrated base's
 * calls go to its own instance, an unmigrated base reads the shared pool
 * while migration writes already target the new instance. No context means
 * the shared/legacy endpoint (health checks, installation-wide graph until
 * it is removed).
 */
export interface ILightragCallContext {
  knowledgeId: string;
  intent: 'read' | 'write';
}

export type LightragConfigResolver = (
  ctx?: ILightragCallContext,
) => Promise<LightragRequestConfig>;

export interface LightragHttpClientOptions {
  resolveConfig: LightragConfigResolver;
  fetchImpl?: FetchImpl;
}

interface ResolvedRequestConfig {
  baseUrl: string;
  apiKey: string;
}

@Injectable()
export class LightragHttpClient extends ILightragClient {
  private readonly logger = new Logger(LightragHttpClient.name);
  private readonly resolveConfig: LightragConfigResolver;
  private readonly fetchImpl: FetchImpl;
  /** `${baseUrl} ${via}` pairs already announced in the log, once each. */
  private readonly contextPathsSeen = new Set<string>();

  constructor(options: LightragHttpClientOptions) {
    super();
    this.resolveConfig = options.resolveConfig;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Runs one exchange with LightRAG (request and body read) under a deadline.
   * An exchange cut short by the deadline surfaces as LightragTimeoutError;
   * anything else passes through untouched.
   */
  private async bounded<T>(
    path: string,
    timeoutMs: number,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LightragTimeoutError(path, timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ILightragHealth> {
    const cfg = await this.requireEnabled();
    return this.bounded('/health', HEALTH_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${cfg.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
        signal,
      });
      await this.ensureOk(res, '/health');
      const body: unknown = await res.json();
      return { ok: true, configuration: extractRuntimeConfig(body) };
    });
  }

  async ingestText(input: IIngestTextInput): Promise<IIngestResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'write',
    });
    return this.bounded('/documents/text', WRITE_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${cfg.baseUrl}/documents/text`, {
        method: 'POST',
        headers: this.headers(cfg.apiKey, {
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          text: input.text,
          file_source: input.fileSource,
        }),
        signal,
      });
      await this.ensureOk(res, '/documents/text');
      return this.extractDocId(res, '/documents/text');
    });
  }

  async ingestUrl(input: IIngestUrlInput): Promise<IIngestResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'write',
    });
    // LightRAG dropped /documents/url; fetch + extract text in ranch-api
    // and forward to /documents/text. file_source carries the URL so the
    // resulting document remains traceable in the LightRAG dashboard.
    const text = await this.fetchAsCleanText(input.url);
    if (text.length === 0) {
      throw new LightragClientError(
        `URL produced no extractable text after HTML strip: ${input.url}`,
        422,
        input.url,
      );
    }
    return this.bounded('/documents/text', WRITE_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${cfg.baseUrl}/documents/text`, {
        method: 'POST',
        headers: this.headers(cfg.apiKey, {
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          text,
          file_source: input.fileSource ?? input.url,
        }),
        signal,
      });
      await this.ensureOk(res, '/documents/text');
      return this.extractDocId(res, '/documents/text');
    });
  }

  private async fetchAsCleanText(url: string): Promise<string> {
    const res = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        // Some docs sites return a generic shell to unknown user agents.
        // A real browser UA gets the rendered HTML reliably.
        'user-agent':
          'Mozilla/5.0 (compatible; RanchKnowledgeBot/1.0; +https://ranch.cleanslice.org)',
      },
    });
    if (!res.ok) {
      throw new LightragClientError(
        `URL fetch failed: ${url} -> HTTP ${res.status}`,
        res.status,
        url,
      );
    }
    const html = await res.text();
    return stripHtmlToText(html);
  }

  async ingestFile(input: IIngestFileInput): Promise<IIngestResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'write',
    });
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.content)], { type: input.mimeType }),
      input.filename,
    );
    // LightRAG renamed /documents/file -> /documents/upload (the old path
    // now 404s, same drift that killed /documents/url). Upload saves the
    // file to the input dir and processes it in the background, returning a
    // track_id like the text endpoints.
    return this.bounded(
      '/documents/upload',
      WRITE_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(`${cfg.baseUrl}/documents/upload`, {
          method: 'POST',
          headers: this.headers(cfg.apiKey),
          body: form,
          signal,
        });
        await this.ensureOk(res, '/documents/upload');
        return this.extractDocId(res, '/documents/upload');
      },
    );
  }

  async query(input: IQueryInput): Promise<IQueryResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'read',
    });
    return this.bounded('/query', QUERY_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${cfg.baseUrl}/query`, {
        method: 'POST',
        headers: this.headers(cfg.apiKey, {
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          query: input.query,
          mode: input.mode ?? 'hybrid',
          top_k: input.topK ?? 10,
          include_references: true,
        }),
        signal,
      });
      await this.ensureOk(res, '/query');
      const body: unknown = await res.json();
      return extractQueryResult(body);
    });
  }

  /**
   * What LightRAG found, not what its model wrote (CLEAN-184). `POST
   * /query/data` returns the chunks, relations and references as data; a
   * deployment older than that route answers 404, and the same content is
   * then read out of `POST /query` with `only_need_context`, whose response
   * is the context template with fenced JSON blocks. Nothing a model wrote
   * at query time is forwarded on either path.
   */
  async retrieveContext(input: IRetrieveContextInput): Promise<IContextResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'read',
    });
    const request = {
      query: input.query,
      mode: input.mode ?? CONTEXT_QUERY_MODE,
      top_k: CONTEXT_TOP_K,
      chunk_top_k: CONTEXT_CHUNK_TOP_K,
      include_references: true,
    };
    const headers = this.headers(cfg.apiKey, {
      'content-type': 'application/json',
    });

    const structured = await this.bounded(
      '/query/data',
      CONTEXT_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(`${cfg.baseUrl}/query/data`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
          signal,
        });
        if (res.status === 404) return null;
        await this.ensureOk(res, '/query/data');
        const body: unknown = await res.json();
        return extractContextData(body);
      },
    );
    if (structured !== null) {
      this.noteContextPath(cfg.baseUrl, 'query_data', structured.dropped);
      return structured.result;
    }

    const parsed = await this.bounded(
      '/query',
      CONTEXT_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(`${cfg.baseUrl}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...request, only_need_context: true }),
          signal,
        });
        await this.ensureOk(res, '/query');
        const body: unknown = await res.json();
        const text =
          isRecord(body) && typeof body.response === 'string'
            ? body.response
            : '';
        return parseContextText(text);
      },
    );
    this.noteContextPath(cfg.baseUrl, 'only_need_context', parsed.dropped);
    return parsed.result;
  }

  /**
   * One log line per deployment and path, so a maintainer can see whether a
   * base is served by the structured route or by the text fallback; and a
   * warning whenever the server handed back chunks it did not label.
   */
  private noteContextPath(
    baseUrl: string,
    via: IContextResult['via'],
    dropped: number,
  ): void {
    const key = `${baseUrl} ${via}`;
    if (!this.contextPathsSeen.has(key)) {
      this.contextPathsSeen.add(key);
      this.logger.log(`context via ${via} for ${baseUrl}`);
    }
    if (dropped > 0) {
      this.logger.warn(
        `context via ${via} for ${baseUrl}: ${dropped} chunk(s) without content or file_path dropped`,
      );
    }
  }

  async deleteDocumentsByTrackIds(
    knowledgeId: string,
    trackIds: string[],
  ): Promise<void> {
    if (trackIds.length === 0) return;
    const cfg = await this.requireEnabled({ knowledgeId, intent: 'write' });
    const docIds: string[] = [];
    for (const trackId of trackIds) {
      const ids = await this.resolveDocIdsByTrackId(cfg, trackId);
      docIds.push(...ids);
    }
    if (docIds.length === 0) return;
    await this.bounded(
      '/documents/delete_document',
      DELETE_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(
          `${cfg.baseUrl}/documents/delete_document`,
          {
            method: 'DELETE',
            headers: this.headers(cfg.apiKey, {
              'content-type': 'application/json',
            }),
            body: JSON.stringify({
              doc_ids: docIds,
              delete_file: false,
              delete_llm_cache: false,
            }),
            signal,
          },
        );
        await this.ensureOk(res, '/documents/delete_document');
      },
    );
  }

  /**
   * Ingest only enqueues, so the track id it returns says nothing about
   * whether the document is searchable yet. This reports where the pipeline
   * actually got to. An unknown track id (404) yields no documents, which
   * callers read as "LightRAG has nothing under this id". Routed with intent
   * 'write': tracking follows the instance the ingest went to, which during
   * migration is the base's own instance rather than the shared pool.
   */
  async getTrackStatus(
    knowledgeId: string,
    trackId: string,
  ): Promise<ITrackStatus> {
    const cfg = await this.requireEnabled({ knowledgeId, intent: 'write' });
    return this.fetchTrackStatus(cfg, trackId);
  }

  /**
   * One snapshot of every document the base's instance holds. Callers index
   * it by doc id or by filename: both are needed to reconcile a source whose
   * upload was refused because the content or the filename is already stored.
   */
  async listDocuments(knowledgeId: string): Promise<IDocumentRecord[]> {
    const cfg = await this.requireEnabled({ knowledgeId, intent: 'write' });
    return this.bounded('/documents', READ_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(`${cfg.baseUrl}/documents`, {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
        signal,
      });
      await this.ensureOk(res, '/documents');
      const body: unknown = await res.json();
      return extractDocuments(body);
    });
  }

  private async fetchTrackStatus(
    cfg: ResolvedRequestConfig,
    trackId: string,
  ): Promise<ITrackStatus> {
    const path = `/documents/track_status/${trackId}`;
    return this.bounded(path, READ_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(
        `${cfg.baseUrl}/documents/track_status/${encodeURIComponent(trackId)}`,
        {
          method: 'GET',
          headers: this.headers(cfg.apiKey),
          signal,
        },
      );
      if (res.status === 404) return { documents: [] };
      await this.ensureOk(res, path);
      const body: unknown = await res.json();
      return extractTrackStatus(body);
    });
  }

  private async resolveDocIdsByTrackId(
    cfg: ResolvedRequestConfig,
    trackId: string,
  ): Promise<string[]> {
    const status = await this.fetchTrackStatus(cfg, trackId);
    return status.documents.map((d) => d.id);
  }

  async getGraphLabels(knowledgeId?: string): Promise<string[]> {
    const cfg = await this.requireEnabled(
      knowledgeId ? { knowledgeId, intent: 'read' } : undefined,
    );
    return this.bounded(
      '/graph/label/list',
      GRAPH_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(`${cfg.baseUrl}/graph/label/list`, {
          method: 'GET',
          headers: this.headers(cfg.apiKey),
          signal,
        });
        await this.ensureOk(res, '/graph/label/list');
        const body: unknown = await res.json();
        return extractLabels(body);
      },
    );
  }

  async getGraph(input: IGetGraphInput): Promise<ILightragGraph> {
    const cfg = await this.requireEnabled(
      input.knowledgeId
        ? { knowledgeId: input.knowledgeId, intent: 'read' }
        : undefined,
    );
    const params = new URLSearchParams({ label: input.label });
    if (input.maxDepth !== undefined) {
      params.set('max_depth', String(input.maxDepth));
    }
    if (input.maxNodes !== undefined) {
      params.set('max_nodes', String(input.maxNodes));
    }
    return this.bounded('/graphs', GRAPH_TIMEOUT_MS, async (signal) => {
      const res = await this.fetchImpl(
        `${cfg.baseUrl}/graphs?${params.toString()}`,
        {
          method: 'GET',
          headers: this.headers(cfg.apiKey),
          signal,
        },
      );
      await this.ensureOk(res, '/graphs');
      const body: unknown = await res.json();
      return extractGraph(body);
    });
  }

  /**
   * The pipeline belongs to one LightRAG instance. Without a knowledge id this
   * asks the shared instance, which is every base while instance isolation is
   * off; a base on its own instance is addressed by id, like getGraphLabels.
   */
  async getPipelineStatus(knowledgeId?: string): Promise<IPipelineStatus> {
    const cfg = await this.requireEnabled(
      knowledgeId ? { knowledgeId, intent: 'write' } : undefined,
    );
    return this.bounded(
      '/documents/pipeline_status',
      READ_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(
          `${cfg.baseUrl}/documents/pipeline_status`,
          { method: 'GET', headers: this.headers(cfg.apiKey), signal },
        );
        await this.ensureOk(res, '/documents/pipeline_status');
        const body: unknown = await res.json();
        return extractPipelineStatus(body);
      },
    );
  }

  /**
   * `reprocess_failed` is a misleading name: the handler hands
   * `apipeline_process_enqueue_documents` no arguments, and that takes every
   * document sitting in PENDING, PROCESSING or FAILED. So this is LightRAG's
   * "pick the queue back up" button, and the only one it has - `/documents/scan`
   * looks like the obvious candidate but only globs the top level of the input
   * directory, and an enqueued file has already been moved into `__enqueued__`
   * by then, so a scan finds nothing to do.
   */
  async restartPipeline(knowledgeId?: string): Promise<void> {
    const cfg = await this.requireEnabled(
      knowledgeId ? { knowledgeId, intent: 'write' } : undefined,
    );
    await this.bounded(
      '/documents/reprocess_failed',
      READ_TIMEOUT_MS,
      async (signal) => {
        const res = await this.fetchImpl(
          `${cfg.baseUrl}/documents/reprocess_failed`,
          { method: 'POST', headers: this.headers(cfg.apiKey), signal },
        );
        await this.ensureOk(res, '/documents/reprocess_failed');
      },
    );
  }

  private async requireEnabled(
    ctx?: ILightragCallContext,
  ): Promise<ResolvedRequestConfig> {
    const cfg = await this.resolveConfig(ctx);
    if (!cfg.enabled || !cfg.url) {
      throw new ServiceUnavailableException(
        ctx
          ? `Retrieval is not available for knowledge ${ctx.knowledgeId}`
          : 'Knowledge service is not configured',
      );
    }
    return {
      baseUrl: cfg.url.replace(/\/+$/, ''),
      apiKey: cfg.apiKey,
    };
  }

  private async extractDocId(
    res: Response,
    path: string,
  ): Promise<IIngestResult> {
    const body = (await res.json()) as { track_id?: string; doc_id?: string };
    const docId = body.track_id ?? body.doc_id;
    if (!docId) {
      throw new LightragClientError(
        `LightRAG ${path}: no track_id/doc_id in response`,
        res.status,
        path,
      );
    }
    return { docId };
  }

  private headers(
    apiKey: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    return {
      'x-api-key': apiKey,
      accept: 'application/json',
      ...extra,
    };
  }

  private async ensureOk(res: Response, path: string): Promise<void> {
    if (res.ok) return;
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      // body already consumed or empty
    }
    throw new LightragClientError(
      `LightRAG ${path} failed: ${res.status} ${bodyText}`.trim(),
      res.status,
      path,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface IParsedContext {
  result: IContextResult;
  /** Chunk items the server returned without `content` or `file_path`. */
  dropped: number;
}

const EMPTY_CONTEXT = (via: IContextResult['via']): IContextResult => ({
  chunks: [],
  relations: [],
  references: [],
  via,
});

/** `POST /query/data`: `{ status, message, data: { entities, relationships, chunks, references }, metadata }`. */
function extractContextData(body: unknown): IParsedContext {
  if (!isRecord(body) || !isRecord(body.data)) {
    // `status: "failure"` with `failure_reason: "no_results"` is LightRAG's
    // way of saying nothing matched — an empty result, not an error.
    return { result: EMPTY_CONTEXT('query_data'), dropped: 0 };
  }
  const data = body.data;
  const { chunks, dropped } = toChunks(asArray(data.chunks));
  const relations = asArray(data.relationships)
    .map((r) => toRelation(r, 'src_id', 'tgt_id'))
    .filter((r): r is IContextRelation => r !== null);
  const references = asArray(data.references)
    .map(toReference)
    .filter((r): r is IQueryReference => r !== null);
  return {
    result: { chunks, relations, references, via: 'query_data' },
    dropped,
  };
}

/**
 * `POST /query` with `only_need_context`: the context template — headings,
 * then fenced JSON arrays for entities, relations and chunks, then a plain
 * fence of `[n] file_path` reference lines. The chunks block is the one that
 * matters; without it the response is something else (a canned refusal, a
 * changed template) and the caller must hear about it rather than receive
 * an empty result that reads as "nothing relevant".
 */
function parseContextText(text: string): IParsedContext {
  const chunksRaw = fencedJsonUnder(text, 'Document Chunks');
  if (chunksRaw === null) {
    throw new LightragClientError(
      'LightRAG /query only_need_context: no parseable "Document Chunks" block in the context',
      200,
      '/query',
    );
  }
  const relationsRaw =
    fencedJsonUnder(text, 'Knowledge Graph Data (Relationship)') ?? [];
  const { chunks, dropped } = toChunks(chunksRaw);
  const relations = relationsRaw
    .map((r) => toRelation(r, 'entity1', 'entity2'))
    .filter((r): r is IContextRelation => r !== null);
  return {
    result: {
      chunks,
      relations,
      references: referenceLinesUnder(text, 'Reference Document List'),
      via: 'only_need_context',
    },
    dropped,
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toChunks(items: unknown[]): {
  chunks: IContextChunk[];
  dropped: number;
} {
  const chunks: IContextChunk[] = [];
  let dropped = 0;
  for (const item of items) {
    if (
      !isRecord(item) ||
      typeof item.content !== 'string' ||
      typeof item.file_path !== 'string'
    ) {
      dropped += 1;
      continue;
    }
    chunks.push({
      text: item.content,
      filePath: item.file_path,
      chunkId: typeof item.chunk_id === 'string' ? item.chunk_id : null,
    });
  }
  return { chunks, dropped };
}

function toRelation(
  value: unknown,
  sourceKey: string,
  targetKey: string,
): IContextRelation | null {
  if (!isRecord(value)) return null;
  const source = value[sourceKey];
  const target = value[targetKey];
  if (typeof source !== 'string' || typeof target !== 'string') return null;
  return {
    source,
    target,
    description: typeof value.description === 'string' ? value.description : '',
  };
}

/**
 * Offset of the first line that starts (after any `-` ruling and spaces)
 * with `heading`; -1 when absent. Line-anchored on purpose: the "Document
 * Chunks" heading itself mentions the "Reference Document List".
 */
function headingOffset(text: string, heading: string): number {
  let offset = 0;
  for (const line of text.split('\n')) {
    if (line.replace(/^[-\s]+/, '').startsWith(heading)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

function fencedJsonUnder(text: string, heading: string): unknown[] | null {
  const at = headingOffset(text, heading);
  if (at < 0) return null;
  const open = text.indexOf('```json', at);
  if (open < 0) return null;
  const start = open + '```json'.length;
  const close = text.indexOf('```', start);
  if (close < 0) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, close));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function referenceLinesUnder(text: string, heading: string): IQueryReference[] {
  const at = headingOffset(text, heading);
  if (at < 0) return [];
  const open = text.indexOf('```', at);
  if (open < 0) return [];
  const start = open + 3;
  const close = text.indexOf('```', start);
  if (close < 0) return [];
  const out: IQueryReference[] = [];
  for (const line of text.slice(start, close).split('\n')) {
    const match = /^\s*\[(\d+)\]\s+(.+?)\s*$/.exec(line);
    if (match) out.push({ referenceId: match[1], filePath: match[2] });
  }
  return out;
}

function toReference(value: unknown): IQueryReference | null {
  if (!isRecord(value)) return null;
  if (typeof value.reference_id !== 'string') return null;
  if (typeof value.file_path !== 'string') return null;
  return {
    referenceId: value.reference_id,
    filePath: value.file_path,
  };
}

function extractQueryResult(body: unknown): IQueryResult {
  if (!isRecord(body)) return { answer: '', references: [] };
  const answer = typeof body.response === 'string' ? body.response : '';
  const rawRefs = Array.isArray(body.references) ? body.references : [];
  const references = rawRefs
    .map(toReference)
    .filter((r): r is IQueryReference => r !== null);
  return { answer, references };
}

function extractLabels(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body.filter((x): x is string => typeof x === 'string');
}

function extractRuntimeConfig(body: unknown): ILightragRuntimeConfig | null {
  if (!isRecord(body)) return null;
  const config = body.configuration;
  if (!isRecord(config)) return null;

  const read = (key: string): string | null => {
    const value = config[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  return {
    llmBinding: read('llm_binding'),
    llmModel: read('llm_model'),
    embeddingBinding: read('embedding_binding'),
    embeddingModel: read('embedding_model'),
    embeddingBindingHost: read('embedding_binding_host'),
  };
}

function extractPipelineStatus(body: unknown): IPipelineStatus {
  if (!isRecord(body)) {
    // A body we cannot read is reported as idle on purpose. The one caller uses
    // this to decide whether to nudge a stalled pipeline, and a nudge is
    // cheap - it ingests nothing - while a wrongly-assumed "busy" would leave
    // a base stuck forever, which is the bug this exists to prevent.
    return { busy: false, docs: 0, currentBatch: 0, latestMessage: '' };
  }
  return {
    busy: body.busy === true,
    docs: isNumber(body.docs) ? body.docs : 0,
    currentBatch: isNumber(body.cur_batch) ? body.cur_batch : 0,
    latestMessage: isString(body.latest_message) ? body.latest_message : '',
  };
}

function extractTrackStatus(body: unknown): ITrackStatus {
  if (!isRecord(body)) return { documents: [] };
  const docs = body.documents;
  if (!Array.isArray(docs)) return { documents: [] };
  const documents: IDocumentProcessingStatus[] = [];
  for (const doc of docs) {
    if (!isRecord(doc) || typeof doc.id !== 'string') continue;
    documents.push({
      id: doc.id,
      status: toProcessingStatus(doc.status),
      errorMessage: typeof doc.error_msg === 'string' ? doc.error_msg : null,
      updatedAt: parseTimestamp(doc.updated_at),
    });
  }
  return { documents };
}

function extractDocuments(body: unknown): IDocumentRecord[] {
  const out: IDocumentRecord[] = [];
  if (!isRecord(body)) return out;
  const statuses = body.statuses;
  if (!isRecord(statuses)) return out;

  for (const [statusName, docs] of Object.entries(statuses)) {
    if (!Array.isArray(docs)) continue;
    for (const doc of docs) {
      if (!isRecord(doc) || typeof doc.id !== 'string') continue;
      out.push({
        id: doc.id,
        // The per-document `status` field is authoritative when present; the
        // bucket name is the fallback (they agree in practice).
        status: toProcessingStatus(doc.status ?? statusName),
        filePath: typeof doc.file_path === 'string' ? doc.file_path : null,
        errorMessage:
          typeof doc.error_msg === 'string' && doc.error_msg !== ''
            ? doc.error_msg
            : null,
        updatedAt: parseTimestamp(doc.updated_at),
      });
    }
  }
  return out;
}

// LightRAG writes UTC. A timestamp without an offset would be read as local
// time by Date.parse, so one is pinned on before parsing.
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(HAS_OFFSET.test(value) ? value : `${value}Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function toProcessingStatus(value: unknown): DocumentProcessingStatusTypes {
  if (value === 'processed' || value === 'failed' || value === 'pending') {
    return value;
  }
  // Anything else - 'processing', or a state a newer LightRAG adds - counts as
  // still in flight. Erring that way makes a poller wait rather than call a
  // document searchable when it is not.
  return 'processing';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

function toRawNode(value: unknown): ILightragGraphNode | null {
  if (!isRecord(value)) return null;
  if (!isString(value.id)) return null;
  const labels = Array.isArray(value.labels)
    ? value.labels.filter(isString)
    : [];
  const props = isRecord(value.properties) ? value.properties : {};
  return {
    id: value.id,
    label: labels[0] ?? value.id,
    entityType: isString(props.entity_type) ? props.entity_type : 'unknown',
    description: isString(props.description) ? props.description : '',
  };
}

function toRawEdge(value: unknown): ILightragGraphEdge | null {
  if (!isRecord(value)) return null;
  if (
    !isString(value.id) ||
    !isString(value.source) ||
    !isString(value.target)
  ) {
    return null;
  }
  const props = isRecord(value.properties) ? value.properties : {};
  return {
    id: value.id,
    source: value.source,
    target: value.target,
    weight: isNumber(props.weight) ? props.weight : 1,
    keywords: isString(props.keywords) ? props.keywords : '',
    description: isString(props.description) ? props.description : '',
  };
}

function extractGraph(body: unknown): ILightragGraph {
  if (!isRecord(body)) {
    return { nodes: [], edges: [], isTruncated: false };
  }
  const rawNodes = Array.isArray(body.nodes) ? body.nodes : [];
  const rawEdges = Array.isArray(body.edges) ? body.edges : [];
  const nodes = rawNodes
    .map(toRawNode)
    .filter((n): n is ILightragGraphNode => n !== null);
  const edges = rawEdges
    .map(toRawEdge)
    .filter((e): e is ILightragGraphEdge => e !== null);
  return {
    nodes,
    edges,
    isTruncated:
      typeof body.is_truncated === 'boolean' ? body.is_truncated : false,
  };
}

// Crude HTML -> text. Drops script/style bodies first so their JS doesn't
// end up as "content", strips remaining tags, decodes the handful of HTML
// entities that show up most often in docs sites, and collapses
// whitespace. Good enough to feed LightRAG entity extraction; a structured
// Readability + Turndown pipeline would be nicer but adds two deps.
function stripHtmlToText(html: string): string {
  let s = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ' ',
  );
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  return s.replace(/\s+/g, ' ').trim();
}
