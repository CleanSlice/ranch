import { Injectable } from '@nestjs/common';
import { ILightragClient } from './lightrag.client';
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
  LightragClientError,
} from './lightrag.types';

type FetchImpl = typeof fetch;

export interface LightragHttpClientConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchImpl;
}

@Injectable()
export class LightragHttpClient extends ILightragClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;

  constructor(config: LightragHttpClientConfig) {
    super();
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async health(): Promise<ILightragHealth> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`, {
      method: 'GET',
      headers: this.headers(),
    });
    await this.ensureOk(res, '/health');
    return { ok: true };
  }

  async ingestText(input: IIngestTextInput): Promise<IIngestResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/documents/text`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        workspace: input.workspace,
        text: input.text,
        file_source: input.fileSource,
      }),
    });
    await this.ensureOk(res, '/documents/text');
    return this.extractDocId(res, '/documents/text');
  }

  async ingestUrl(input: IIngestUrlInput): Promise<IIngestResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/documents/url`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        workspace: input.workspace,
        url: input.url,
      }),
    });
    await this.ensureOk(res, '/documents/url');
    return this.extractDocId(res, '/documents/url');
  }

  async ingestFile(input: IIngestFileInput): Promise<IIngestResult> {
    const form = new FormData();
    form.append('workspace', input.workspace);
    form.append(
      'file',
      new Blob([new Uint8Array(input.content)], { type: input.mimeType }),
      input.filename,
    );
    const res = await this.fetchImpl(`${this.baseUrl}/documents/file`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    await this.ensureOk(res, '/documents/file');
    return this.extractDocId(res, '/documents/file');
  }

  async query(input: IQueryInput): Promise<IQueryResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
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

  async deleteDocumentsByTrackIds(trackIds: string[]): Promise<void> {
    if (trackIds.length === 0) return;
    const docIds: string[] = [];
    for (const trackId of trackIds) {
      const ids = await this.resolveDocIdsByTrackId(trackId);
      docIds.push(...ids);
    }
    if (docIds.length === 0) return;
    const res = await this.fetchImpl(
      `${this.baseUrl}/documents/delete_document`,
      {
        method: 'DELETE',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          doc_ids: docIds,
          delete_file: false,
          delete_llm_cache: false,
        }),
      },
    );
    await this.ensureOk(res, '/documents/delete_document');
  }

  private async resolveDocIdsByTrackId(trackId: string): Promise<string[]> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/documents/track_status/${encodeURIComponent(trackId)}`,
      {
        method: 'GET',
        headers: this.headers(),
      },
    );
    if (res.status === 404) return [];
    await this.ensureOk(res, `/documents/track_status/${trackId}`);
    const body: unknown = await res.json();
    return extractTrackStatusDocIds(body);
  }

  async getGraphLabels(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/graph/label/list`, {
      method: 'GET',
      headers: this.headers(),
    });
    await this.ensureOk(res, '/graph/label/list');
    const body: unknown = await res.json();
    return extractLabels(body);
  }

  async getGraph(input: IGetGraphInput): Promise<ILightragGraph> {
    const params = new URLSearchParams({ label: input.label });
    if (input.maxDepth !== undefined) {
      params.set('max_depth', String(input.maxDepth));
    }
    if (input.maxNodes !== undefined) {
      params.set('max_nodes', String(input.maxNodes));
    }
    const res = await this.fetchImpl(
      `${this.baseUrl}/graphs?${params.toString()}`,
      {
        method: 'GET',
        headers: this.headers(),
      },
    );
    await this.ensureOk(res, '/graphs');
    const body: unknown = await res.json();
    return extractGraph(body);
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

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
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
