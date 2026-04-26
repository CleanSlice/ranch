import { Injectable } from '@nestjs/common';
import { ILightragClient } from './lightrag.client';
import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResultItem,
  ILightragHealth,
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

  async query(input: IQueryInput): Promise<IQueryResultItem[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/query/data`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        workspace: input.workspace,
        query: input.query,
        mode: input.mode ?? 'hybrid',
        top_k: input.topK ?? 25,
      }),
    });
    await this.ensureOk(res, '/query/data');
    const body: unknown = await res.json();
    return extractChunks(body);
  }

  async deleteDocument(workspace: string, docId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/documents`, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        workspace,
        doc_ids: [docId],
      }),
    });
    await this.ensureOk(res, '/documents');
  }

  async deleteWorkspace(workspace: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/workspaces/${encodeURIComponent(workspace)}`,
      {
        method: 'DELETE',
        headers: this.headers(),
      },
    );
    await this.ensureOk(res, `/workspaces/${workspace}`);
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

interface IRawChunk {
  content: string;
  file_path?: string;
  chunk_id?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRawChunk(value: unknown): value is IRawChunk {
  if (!isRecord(value)) return false;
  if (typeof value.content !== 'string' || value.content.length === 0) {
    return false;
  }
  if (value.file_path !== undefined && typeof value.file_path !== 'string') {
    return false;
  }
  if (value.chunk_id !== undefined && typeof value.chunk_id !== 'string') {
    return false;
  }
  return true;
}

function extractChunks(body: unknown): IQueryResultItem[] {
  if (!isRecord(body)) return [];
  const data = body.data;
  if (!isRecord(data)) return [];
  const chunks = data.chunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.filter(isRawChunk).map((c) => ({
    pageContent: c.content,
    metadata: {
      title: c.file_path,
      source: c.file_path,
      sourceId: c.chunk_id,
    },
  }));
}
