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
      return { ok: true };
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

  async getTrackStatus(
    knowledgeId: string,
    trackId: string,
  ): Promise<ITrackStatus> {
    const cfg = await this.requireEnabled({ knowledgeId, intent: 'write' });
    const res = await this.fetchImpl(
      `${cfg.baseUrl}/documents/track_status/${encodeURIComponent(trackId)}`,
      {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
      },
    );
    if (res.status === 404) return { status: 'pending', error: null };
    await this.ensureOk(res, `/documents/track_status/${trackId}`);
    const body: unknown = await res.json();
    return extractTrackStatus(body);
  }

  private async resolveDocIdsByTrackId(
    cfg: ResolvedRequestConfig,
    trackId: string,
  ): Promise<string[]> {
    const res = await this.fetchImpl(
      `${cfg.baseUrl}/documents/track_status/${encodeURIComponent(trackId)}`,
      {
        method: 'GET',
        headers: this.headers(cfg.apiKey),
      },
    );
    if (res.status === 404) return [];
    await this.ensureOk(res, `/documents/track_status/${trackId}`);
    const body: unknown = await res.json();
    return extractTrackStatusDocIds(body);
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

// One track id can cover several documents (an archive upload); the source
// is 'processed' only when every one of them is, 'failed' as soon as any is.
export function extractTrackStatus(body: unknown): ITrackStatus {
  if (!isRecord(body)) return { status: 'pending', error: null };
  const docs = Array.isArray(body.documents) ? body.documents : [];
  if (docs.length === 0) return { status: 'pending', error: null };

  let sawProcessing = false;
  let sawPending = false;
  for (const doc of docs) {
    if (!isRecord(doc)) continue;
    const status = typeof doc.status === 'string' ? doc.status : '';
    if (status === 'failed') {
      const error =
        typeof doc.error_msg === 'string' && doc.error_msg.length > 0
          ? doc.error_msg
          : 'processing failed';
      return { status: 'failed', error };
    }
    if (status === 'processing') sawProcessing = true;
    if (status === 'pending' || status === 'enqueued') sawPending = true;
  }
  if (sawProcessing) return { status: 'processing', error: null };
  if (sawPending) return { status: 'pending', error: null };
  return { status: 'processed', error: null };
}

function extractTrackStatusDocIds(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const docs = body.documents;
  if (!Array.isArray(docs)) return [];
  const ids: string[] = [];
  for (const doc of docs) {
    if (isRecord(doc) && typeof doc.id === 'string') {
      ids.push(doc.id);
    }
  }
  return ids;
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
