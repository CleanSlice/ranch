import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ILightragClient } from '../domain/lightrag.client';
import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResult,
  IQueryReference,
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
} from '../domain/lightrag.types';

type FetchImpl = typeof fetch;

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
  private readonly resolveConfig: LightragConfigResolver;
  private readonly fetchImpl: FetchImpl;

  constructor(options: LightragHttpClientOptions) {
    super();
    this.resolveConfig = options.resolveConfig;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<ILightragHealth> {
    const cfg = await this.requireEnabled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await this.fetchImpl(`${cfg.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
        signal: controller.signal,
      });
      await this.ensureOk(res, '/health');
      const body: unknown = await res.json();
      return { ok: true, configuration: extractRuntimeConfig(body) };
    } finally {
      clearTimeout(timer);
    }
  }

  async ingestText(input: IIngestTextInput): Promise<IIngestResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'write',
    });
    const res = await this.fetchImpl(`${cfg.baseUrl}/documents/text`, {
      method: 'POST',
      headers: this.headers(cfg.apiKey, {
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        text: input.text,
        file_source: input.fileSource,
      }),
    });
    await this.ensureOk(res, '/documents/text');
    return this.extractDocId(res, '/documents/text');
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
    const res = await this.fetchImpl(`${cfg.baseUrl}/documents/text`, {
      method: 'POST',
      headers: this.headers(cfg.apiKey, {
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        text,
        file_source: input.fileSource ?? input.url,
      }),
    });
    await this.ensureOk(res, '/documents/text');
    return this.extractDocId(res, '/documents/text');
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
    const res = await this.fetchImpl(`${cfg.baseUrl}/documents/upload`, {
      method: 'POST',
      headers: this.headers(cfg.apiKey),
      body: form,
    });
    await this.ensureOk(res, '/documents/upload');
    return this.extractDocId(res, '/documents/upload');
  }

  async query(input: IQueryInput): Promise<IQueryResult> {
    const cfg = await this.requireEnabled({
      knowledgeId: input.knowledgeId,
      intent: 'read',
    });
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
    });
    await this.ensureOk(res, '/query');
    const body: unknown = await res.json();
    return extractQueryResult(body);
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
      },
    );
    await this.ensureOk(res, '/documents/delete_document');
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
    const res = await this.fetchImpl(`${cfg.baseUrl}/documents`, {
      method: 'GET',
      headers: this.headers(cfg.apiKey),
    });
    await this.ensureOk(res, '/documents');
    const body: unknown = await res.json();
    return extractDocuments(body);
  }

  private async fetchTrackStatus(
    cfg: ResolvedRequestConfig,
    trackId: string,
  ): Promise<ITrackStatus> {
    const res = await this.fetchImpl(
      `${cfg.baseUrl}/documents/track_status/${encodeURIComponent(trackId)}`,
      {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
      },
    );
    if (res.status === 404) return { documents: [] };
    await this.ensureOk(res, `/documents/track_status/${trackId}`);
    const body: unknown = await res.json();
    return extractTrackStatus(body);
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
    const res = await this.fetchImpl(`${cfg.baseUrl}/graph/label/list`, {
      method: 'GET',
      headers: this.headers(cfg.apiKey),
    });
    await this.ensureOk(res, '/graph/label/list');
    const body: unknown = await res.json();
    return extractLabels(body);
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
    const res = await this.fetchImpl(
      `${cfg.baseUrl}/graphs?${params.toString()}`,
      {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
      },
    );
    await this.ensureOk(res, '/graphs');
    const body: unknown = await res.json();
    return extractGraph(body);
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
    const res = await this.fetchImpl(
      `${cfg.baseUrl}/documents/pipeline_status`,
      { method: 'GET', headers: this.headers(cfg.apiKey) },
    );
    await this.ensureOk(res, '/documents/pipeline_status');
    const body: unknown = await res.json();
    return extractPipelineStatus(body);
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
    const res = await this.fetchImpl(
      `${cfg.baseUrl}/documents/reprocess_failed`,
      { method: 'POST', headers: this.headers(cfg.apiKey) },
    );
    await this.ensureOk(res, '/documents/reprocess_failed');
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
      });
    }
  }
  return out;
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
