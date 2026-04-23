# Reins (LightRAG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `reins` slice to Ranch that wraps a self-hosted LightRAG service and exposes a Knowledge feature (CRUD + ingestion + vector query) through Ranch API and admin UI.

**Architecture:** Reins is a thin NestJS proxy to a separate LightRAG container. Ranch Postgres stores knowledge metadata (name, sources, index status). LightRAG has its own Postgres (pgvector + AGE) for chunks, embeddings, and graph. Admin UI follows the split-pages convention (list / create / edit with tabs). No app/slices/reins in v1.

**Tech Stack:** NestJS 11 + Prisma 6 (api), Nuxt 3 + Vue 3 + Pinia (admin), LightRAG via `ghcr.io/hkuds/lightrag:latest`, MinIO for source files, docker-compose locally, k8s for prod.

**Reference spec:** `docs/superpowers/specs/2026-04-23-reins-lightrag-integration-design.md`

---

## Phase 0 — Pre-flight

### Task 0.1: Verify environment and baseline

**Files:** none (sanity checks only)

- [ ] **Step 1: Confirm you are on main and working tree clean for the reins work**

Run:
```bash
cd /Users/hatsaxi/Work/ranch
git status
git log --oneline -3
```

Expected: `main` branch, recent commits include `3c0762b docs: add Reins + LightRAG integration design spec`. If `api/docker-compose.yml` and `k8s/templates/agent-workflow.yaml` are still modified, leave them alone — they are prior setup fixes and not part of this work.

- [ ] **Step 2: Confirm the empty reins folder exists**

Run:
```bash
ls -la api/src/slices/reins/
```

Expected: empty directory (no files). If missing, create: `mkdir -p api/src/slices/reins`.

- [ ] **Step 3: Verify local Postgres and MinIO are running**

Run:
```bash
docker compose -f api/docker-compose.yml ps
```

Expected: `ranch-postgres` and `minio` containers `Up (healthy)`. If not, run `make dev` or `docker compose -f api/docker-compose.yml up -d` first.

---

## Phase 1 — Backend: Prisma schema and migration

### Task 1.1: Create Prisma model for Knowledge and ReinsSource

**Files:**
- Create: `api/src/slices/reins/reins.prisma`

- [ ] **Step 1: Create the slice Prisma file**

Create `api/src/slices/reins/reins.prisma`:

```prisma
model Knowledge {
  id                String        @id @default(uuid())
  name              String
  description       String?
  workspace         String        @unique
  entityTypes       String[]      @default([])
  relationshipTypes String[]      @default([])
  indexStatus       String        @default("idle")
  indexError        String?
  indexedAt         DateTime?
  indexStartedAt    DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  sources           ReinsSource[]

  @@index([indexStatus])
}

model ReinsSource {
  id            String    @id @default(uuid())
  knowledgeId   String
  knowledge     Knowledge @relation(fields: [knowledgeId], references: [id], onDelete: Cascade)
  type          String
  name          String
  url           String?
  mimeType      String?
  content       String?
  sizeBytes     Int?
  lightragDocId String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([knowledgeId])
  @@index([lightragDocId])
}
```

- [ ] **Step 2: Regenerate combined Prisma schema**

Run from `api/`:
```bash
cd api && npm run generate
```

Expected: writes `api/prisma/schema.prisma` with the new models included. Inspect with `grep -A 20 "model Knowledge" api/prisma/schema.prisma` to confirm the block is present.

- [ ] **Step 3: Run migration**

Run from `api/`:
```bash
npm run migrate
```

Expected: Prisma prompts for a migration name (auto-suggested: `auto`), creates a file under `api/prisma/migrations/<timestamp>_auto/migration.sql`, applies it, regenerates `@prisma/client`. No errors.

Verify tables exist:
```bash
docker exec -it ranch-postgres psql -U postgres -d ranch-local -c "\dt"
```
Expected: rows include `Knowledge` and `ReinsSource`.

- [ ] **Step 4: Commit**

```bash
git add api/src/slices/reins/reins.prisma api/prisma/migrations
git commit -m "feat(reins): add Knowledge and ReinsSource Prisma models"
```

---

## Phase 2 — Backend: Domain types and abstract gateway

### Task 2.1: Domain types

**Files:**
- Create: `api/src/slices/reins/domain/reins.types.ts`

- [ ] **Step 1: Write the types file**

Create `api/src/slices/reins/domain/reins.types.ts`:

```typescript
export type IndexStatusTypes = 'idle' | 'indexing' | 'ready' | 'failed';

export type SourceTypes = 'file' | 'url' | 'text';

export type QueryModeTypes = 'hybrid' | 'local' | 'global' | 'naive';

export interface IKnowledgeData {
  id: string;
  name: string;
  description: string | null;
  workspace: string;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatusTypes;
  indexError: string | null;
  indexedAt: Date | null;
  indexStartedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sources?: IReinsSourceData[];
}

export interface IReinsSourceData {
  id: string;
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  lightragDocId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateKnowledgeData {
  name: string;
  description?: string;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IUpdateKnowledgeData {
  name?: string;
  description?: string | null;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface ICreateSourceData {
  knowledgeId: string;
  type: SourceTypes;
  name: string;
  url?: string;
  mimeType?: string;
  content?: string;
  sizeBytes?: number;
}

export interface IKnowledgeQueryRecord {
  pageContent: string;
  metadata: {
    title?: string;
    source?: string;
    sourceId?: string;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/domain/reins.types.ts
git commit -m "feat(reins): add domain types"
```

### Task 2.2: Abstract gateway

**Files:**
- Create: `api/src/slices/reins/domain/reins.gateway.ts`

- [ ] **Step 1: Write the abstract gateway**

Create `api/src/slices/reins/domain/reins.gateway.ts`:

```typescript
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IndexStatusTypes,
} from './reins.types';

export abstract class IReinsGateway {
  abstract findAllKnowledge(): Promise<IKnowledgeData[]>;
  abstract findKnowledgeById(id: string): Promise<IKnowledgeData | null>;
  abstract createKnowledge(data: ICreateKnowledgeData): Promise<IKnowledgeData>;
  abstract updateKnowledge(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData>;
  abstract updateKnowledgeIndexState(
    id: string,
    patch: {
      indexStatus: IndexStatusTypes;
      indexError?: string | null;
      indexedAt?: Date | null;
      indexStartedAt?: Date | null;
    },
  ): Promise<IKnowledgeData>;
  abstract deleteKnowledge(id: string): Promise<void>;

  abstract findSourcesByKnowledge(
    knowledgeId: string,
  ): Promise<IReinsSourceData[]>;
  abstract findSourceById(id: string): Promise<IReinsSourceData | null>;
  abstract createSource(data: ICreateSourceData): Promise<IReinsSourceData>;
  abstract setSourceLightragDocId(
    id: string,
    lightragDocId: string,
  ): Promise<IReinsSourceData>;
  abstract deleteSource(id: string): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/domain/reins.gateway.ts
git commit -m "feat(reins): add abstract gateway"
```

### Task 2.3: Domain barrel

**Files:**
- Create: `api/src/slices/reins/domain/index.ts`

- [ ] **Step 1: Write barrel**

Create `api/src/slices/reins/domain/index.ts`:

```typescript
export * from './reins.types';
export * from './reins.gateway';
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/domain/index.ts
git commit -m "feat(reins): add domain barrel export"
```

---

## Phase 3 — Backend: LightRAG HTTP client

### Task 3.1: LightRAG client interface and error type

**Files:**
- Create: `api/src/slices/reins/data/lightrag.types.ts`

- [ ] **Step 1: Write types**

Create `api/src/slices/reins/data/lightrag.types.ts`:

```typescript
import { QueryModeTypes } from '../domain/reins.types';

export interface IIngestTextInput {
  workspace: string;
  text: string;
  fileSource?: string;
}

export interface IIngestUrlInput {
  workspace: string;
  url: string;
}

export interface IIngestFileInput {
  workspace: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IIngestResult {
  docId: string;
}

export interface IQueryInput {
  workspace: string;
  query: string;
  mode?: QueryModeTypes;
  topK?: number;
}

export interface IQueryResultItem {
  pageContent: string;
  metadata: {
    title?: string;
    source?: string;
    sourceId?: string;
  };
}

export interface ILightragHealth {
  ok: boolean;
}

export class LightragClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'LightragClientError';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/data/lightrag.types.ts
git commit -m "feat(reins): add LightRAG client types"
```

### Task 3.2: Abstract LightRAG client

**Files:**
- Create: `api/src/slices/reins/data/lightrag.client.ts`

- [ ] **Step 1: Write abstract class**

Create `api/src/slices/reins/data/lightrag.client.ts`:

```typescript
import {
  IIngestTextInput,
  IIngestUrlInput,
  IIngestFileInput,
  IIngestResult,
  IQueryInput,
  IQueryResultItem,
  ILightragHealth,
} from './lightrag.types';

export abstract class ILightragClient {
  abstract health(): Promise<ILightragHealth>;
  abstract ingestText(input: IIngestTextInput): Promise<IIngestResult>;
  abstract ingestUrl(input: IIngestUrlInput): Promise<IIngestResult>;
  abstract ingestFile(input: IIngestFileInput): Promise<IIngestResult>;
  abstract query(input: IQueryInput): Promise<IQueryResultItem[]>;
  abstract deleteDocument(workspace: string, docId: string): Promise<void>;
  abstract deleteWorkspace(workspace: string): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/data/lightrag.client.ts
git commit -m "feat(reins): add abstract LightRAG client"
```

### Task 3.3: HTTP implementation of LightRAG client (TDD)

**Files:**
- Create: `api/src/slices/reins/data/lightragHttp.client.ts`
- Test: `api/src/slices/reins/data/lightragHttp.client.spec.ts`

- [ ] **Step 1: Write the failing test for health check**

Create `api/src/slices/reins/data/lightragHttp.client.spec.ts`:

```typescript
import { LightragHttpClient } from './lightragHttp.client';
import { LightragClientError } from './lightrag.types';

type FetchMock = jest.Mock<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>;

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LightragHttpClient', () => {
  let fetchMock: FetchMock;
  let client: LightragHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn() as FetchMock;
    client = new LightragHttpClient({
      baseUrl: 'http://lightrag.test:9621',
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });
  });

  describe('health', () => {
    it('returns ok=true when LightRAG responds 200', async () => {
      fetchMock.mockResolvedValue(makeResponse({ status: 'ok' }));
      const result = await client.health();
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://lightrag.test:9621/health',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-key',
          }),
        }),
      );
    });

    it('throws LightragClientError when response is non-2xx', async () => {
      fetchMock.mockResolvedValue(makeResponse({ detail: 'bad' }, 500));
      await expect(client.health()).rejects.toBeInstanceOf(LightragClientError);
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from `api/`:
```bash
npx jest reins/data/lightragHttp.client.spec.ts
```

Expected: FAIL with "Cannot find module `./lightragHttp.client`".

- [ ] **Step 3: Write minimal implementation to pass health test**

Create `api/src/slices/reins/data/lightragHttp.client.ts`:

```typescript
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

  async ingestText(_input: IIngestTextInput): Promise<IIngestResult> {
    throw new Error('not implemented');
  }

  async ingestUrl(_input: IIngestUrlInput): Promise<IIngestResult> {
    throw new Error('not implemented');
  }

  async ingestFile(_input: IIngestFileInput): Promise<IIngestResult> {
    throw new Error('not implemented');
  }

  async query(_input: IQueryInput): Promise<IQueryResultItem[]> {
    throw new Error('not implemented');
  }

  async deleteDocument(_workspace: string, _docId: string): Promise<void> {
    throw new Error('not implemented');
  }

  async deleteWorkspace(_workspace: string): Promise<void> {
    throw new Error('not implemented');
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest reins/data/lightragHttp.client.spec.ts
```

Expected: 2 tests PASS (health ok, health error).

- [ ] **Step 5: Extend test with ingestText**

Append to `lightragHttp.client.spec.ts` inside the outer `describe('LightragHttpClient', ...)` block:

```typescript
  describe('ingestText', () => {
    it('POSTs /documents/text with workspace and returns doc id', async () => {
      fetchMock.mockResolvedValue(
        makeResponse({ track_id: 'doc-abc-123' }, 200),
      );
      const result = await client.ingestText({
        workspace: 'knowledge_1',
        text: 'hello world',
        fileSource: 'notes.md',
      });
      expect(result.docId).toBe('doc-abc-123');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://lightrag.test:9621/documents/text',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            'x-api-key': 'test-key',
          }),
          body: expect.stringContaining('"workspace":"knowledge_1"'),
        }),
      );
    });
  });
```

- [ ] **Step 6: Run — should fail because ingestText is stub**

```bash
npx jest reins/data/lightragHttp.client.spec.ts -t 'ingestText'
```

Expected: FAIL with "not implemented".

- [ ] **Step 7: Implement `ingestText`**

Replace the `ingestText` method in `lightragHttp.client.ts`:

```typescript
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
    const body = (await res.json()) as { track_id?: string; doc_id?: string };
    const docId = body.track_id ?? body.doc_id;
    if (!docId) {
      throw new LightragClientError(
        'LightRAG ingestText: no track_id/doc_id in response',
        res.status,
        '/documents/text',
      );
    }
    return { docId };
  }
```

- [ ] **Step 8: Run tests — all should pass**

```bash
npx jest reins/data/lightragHttp.client.spec.ts
```

Expected: 3 tests PASS.

- [ ] **Step 9: Add ingestUrl test and implementation**

Append test:

```typescript
  describe('ingestUrl', () => {
    it('POSTs /documents/url and returns doc id', async () => {
      fetchMock.mockResolvedValue(makeResponse({ track_id: 'doc-url-42' }));
      const result = await client.ingestUrl({
        workspace: 'knowledge_1',
        url: 'https://example.com/article',
      });
      expect(result.docId).toBe('doc-url-42');
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe('http://lightrag.test:9621/documents/url');
      const init = call[1];
      expect(init?.method).toBe('POST');
      expect(init?.body).toContain('"url":"https://example.com/article"');
    });
  });
```

Run to confirm FAIL:
```bash
npx jest reins/data/lightragHttp.client.spec.ts -t 'ingestUrl'
```

Implement — replace the `ingestUrl` stub:

```typescript
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
    const body = (await res.json()) as { track_id?: string; doc_id?: string };
    const docId = body.track_id ?? body.doc_id;
    if (!docId) {
      throw new LightragClientError(
        'LightRAG ingestUrl: no track_id/doc_id in response',
        res.status,
        '/documents/url',
      );
    }
    return { docId };
  }
```

Run:
```bash
npx jest reins/data/lightragHttp.client.spec.ts
```
Expected: 4 tests PASS.

- [ ] **Step 10: Add ingestFile test and implementation**

Append test:

```typescript
  describe('ingestFile', () => {
    it('POSTs /documents/file with multipart form', async () => {
      fetchMock.mockResolvedValue(makeResponse({ track_id: 'doc-file-7' }));
      const result = await client.ingestFile({
        workspace: 'knowledge_1',
        filename: 'paper.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('%PDF-1.4 stub'),
      });
      expect(result.docId).toBe('doc-file-7');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://lightrag.test:9621/documents/file');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
    });
  });
```

Implement — replace `ingestFile`:

```typescript
  async ingestFile(input: IIngestFileInput): Promise<IIngestResult> {
    const form = new FormData();
    form.append('workspace', input.workspace);
    form.append(
      'file',
      new Blob([input.content], { type: input.mimeType }),
      input.filename,
    );
    const res = await this.fetchImpl(`${this.baseUrl}/documents/file`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    await this.ensureOk(res, '/documents/file');
    const body = (await res.json()) as { track_id?: string; doc_id?: string };
    const docId = body.track_id ?? body.doc_id;
    if (!docId) {
      throw new LightragClientError(
        'LightRAG ingestFile: no track_id/doc_id in response',
        res.status,
        '/documents/file',
      );
    }
    return { docId };
  }
```

Run:
```bash
npx jest reins/data/lightragHttp.client.spec.ts
```
Expected: 5 tests PASS.

- [ ] **Step 11: Add query test and implementation**

Append test:

```typescript
  describe('query', () => {
    it('POSTs /query and maps LightRAG response to IQueryResultItem[]', async () => {
      fetchMock.mockResolvedValue(
        makeResponse({
          response: 'unused',
          chunks: [
            {
              content: 'A paragraph about cats.',
              file_path: 'cats.md',
              source_id: 'doc-1',
            },
            {
              content: 'Another about dogs.',
              file_path: 'dogs.md',
              source_id: 'doc-2',
            },
          ],
        }),
      );
      const result = await client.query({
        workspace: 'knowledge_1',
        query: 'pets',
        mode: 'hybrid',
        topK: 10,
      });
      expect(result).toHaveLength(2);
      expect(result[0].pageContent).toBe('A paragraph about cats.');
      expect(result[0].metadata.title).toBe('cats.md');
      expect(result[0].metadata.sourceId).toBe('doc-1');
    });
  });
```

Implement — replace `query`:

```typescript
  async query(input: IQueryInput): Promise<IQueryResultItem[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        workspace: input.workspace,
        query: input.query,
        mode: input.mode ?? 'hybrid',
        top_k: input.topK ?? 25,
      }),
    });
    await this.ensureOk(res, '/query');
    const body = (await res.json()) as {
      chunks?: Array<{
        content?: string;
        file_path?: string;
        source_id?: string;
      }>;
    };
    const chunks = body.chunks ?? [];
    return chunks
      .filter((c): c is { content: string; file_path?: string; source_id?: string } =>
        typeof c.content === 'string' && c.content.length > 0,
      )
      .map((c) => ({
        pageContent: c.content,
        metadata: {
          title: c.file_path,
          source: c.file_path,
          sourceId: c.source_id,
        },
      }));
  }
```

Run:
```bash
npx jest reins/data/lightragHttp.client.spec.ts
```
Expected: 6 tests PASS.

- [ ] **Step 12: Add deleteDocument and deleteWorkspace tests and impl**

Append test:

```typescript
  describe('deleteDocument', () => {
    it('DELETEs /documents with workspace and doc id', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await client.deleteDocument('knowledge_1', 'doc-file-7');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://lightrag.test:9621/documents');
      expect(init?.method).toBe('DELETE');
      expect(init?.body).toContain('"doc_ids":["doc-file-7"]');
      expect(init?.body).toContain('"workspace":"knowledge_1"');
    });
  });

  describe('deleteWorkspace', () => {
    it('DELETEs /workspaces/:workspace', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await client.deleteWorkspace('knowledge_1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://lightrag.test:9621/workspaces/knowledge_1');
      expect(init?.method).toBe('DELETE');
    });
  });
```

Implement — replace stubs:

```typescript
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
```

Run:
```bash
npx jest reins/data/lightragHttp.client.spec.ts
```
Expected: 8 tests PASS.

- [ ] **Step 13: Commit**

```bash
git add api/src/slices/reins/data/lightragHttp.client.ts api/src/slices/reins/data/lightragHttp.client.spec.ts api/src/slices/reins/data/lightrag.types.ts api/src/slices/reins/data/lightrag.client.ts
git commit -m "feat(reins): add HTTP LightRAG client with unit tests"
```

---

## Phase 4 — Backend: Data gateway and mapper

### Task 4.1: Mapper

**Files:**
- Create: `api/src/slices/reins/data/reins.mapper.ts`

- [ ] **Step 1: Write mapper**

Create `api/src/slices/reins/data/reins.mapper.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import type {
  Knowledge as PrismaKnowledge,
  ReinsSource as PrismaReinsSource,
} from '@prisma/client';
import {
  IKnowledgeData,
  IReinsSourceData,
  IndexStatusTypes,
  SourceTypes,
} from '../domain/reins.types';

const INDEX_STATUSES: readonly IndexStatusTypes[] = [
  'idle',
  'indexing',
  'ready',
  'failed',
];
const SOURCE_TYPES: readonly SourceTypes[] = ['file', 'url', 'text'];

function parseIndexStatus(value: string): IndexStatusTypes {
  return INDEX_STATUSES.includes(value as IndexStatusTypes)
    ? (value as IndexStatusTypes)
    : 'idle';
}

function parseSourceType(value: string): SourceTypes {
  return SOURCE_TYPES.includes(value as SourceTypes)
    ? (value as SourceTypes)
    : 'text';
}

@Injectable()
export class ReinsMapper {
  toKnowledgeEntity(
    record: PrismaKnowledge & { sources?: PrismaReinsSource[] },
  ): IKnowledgeData {
    return {
      id: record.id,
      name: record.name,
      description: record.description ?? null,
      workspace: record.workspace,
      entityTypes: record.entityTypes,
      relationshipTypes: record.relationshipTypes,
      indexStatus: parseIndexStatus(record.indexStatus),
      indexError: record.indexError ?? null,
      indexedAt: record.indexedAt ?? null,
      indexStartedAt: record.indexStartedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      sources: record.sources?.map((s) => this.toSourceEntity(s)),
    };
  }

  toSourceEntity(record: PrismaReinsSource): IReinsSourceData {
    return {
      id: record.id,
      knowledgeId: record.knowledgeId,
      type: parseSourceType(record.type),
      name: record.name,
      url: record.url ?? null,
      mimeType: record.mimeType ?? null,
      content: record.content ?? null,
      sizeBytes: record.sizeBytes ?? null,
      lightragDocId: record.lightragDocId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/data/reins.mapper.ts
git commit -m "feat(reins): add Prisma-to-domain mapper"
```

### Task 4.2: Concrete Prisma gateway

**Files:**
- Create: `api/src/slices/reins/data/reins.gateway.ts`

- [ ] **Step 1: Write concrete gateway**

Create `api/src/slices/reins/data/reins.gateway.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IReinsGateway } from '../domain/reins.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IndexStatusTypes,
} from '../domain/reins.types';
import { ReinsMapper } from './reins.mapper';

function workspaceOf(id: string): string {
  return `knowledge_${id.replace(/-/g, '')}`;
}

@Injectable()
export class ReinsGateway extends IReinsGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: ReinsMapper,
  ) {
    super();
  }

  async findAllKnowledge(): Promise<IKnowledgeData[]> {
    const records = await this.prisma.knowledge.findMany({
      include: { sources: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toKnowledgeEntity(r));
  }

  async findKnowledgeById(id: string): Promise<IKnowledgeData | null> {
    const record = await this.prisma.knowledge.findUnique({
      where: { id },
      include: { sources: true },
    });
    return record ? this.mapper.toKnowledgeEntity(record) : null;
  }

  async createKnowledge(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledge.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          entityTypes: data.entityTypes ?? [],
          relationshipTypes: data.relationshipTypes ?? [],
          workspace: 'pending',
        },
      });
      return tx.knowledge.update({
        where: { id: created.id },
        data: { workspace: workspaceOf(created.id) },
        include: { sources: true },
      });
    });
    return this.mapper.toKnowledgeEntity(record);
  }

  async updateKnowledge(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.entityTypes && { entityTypes: data.entityTypes }),
        ...(data.relationshipTypes && {
          relationshipTypes: data.relationshipTypes,
        }),
      },
      include: { sources: true },
    });
    return this.mapper.toKnowledgeEntity(record);
  }

  async updateKnowledgeIndexState(
    id: string,
    patch: {
      indexStatus: IndexStatusTypes;
      indexError?: string | null;
      indexedAt?: Date | null;
      indexStartedAt?: Date | null;
    },
  ): Promise<IKnowledgeData> {
    const record = await this.prisma.knowledge.update({
      where: { id },
      data: {
        indexStatus: patch.indexStatus,
        ...(patch.indexError !== undefined && { indexError: patch.indexError }),
        ...(patch.indexedAt !== undefined && { indexedAt: patch.indexedAt }),
        ...(patch.indexStartedAt !== undefined && {
          indexStartedAt: patch.indexStartedAt,
        }),
      },
      include: { sources: true },
    });
    return this.mapper.toKnowledgeEntity(record);
  }

  async deleteKnowledge(id: string): Promise<void> {
    await this.prisma.knowledge.delete({ where: { id } });
  }

  async findSourcesByKnowledge(
    knowledgeId: string,
  ): Promise<IReinsSourceData[]> {
    const records = await this.prisma.reinsSource.findMany({
      where: { knowledgeId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toSourceEntity(r));
  }

  async findSourceById(id: string): Promise<IReinsSourceData | null> {
    const record = await this.prisma.reinsSource.findUnique({ where: { id } });
    return record ? this.mapper.toSourceEntity(record) : null;
  }

  async createSource(data: ICreateSourceData): Promise<IReinsSourceData> {
    const record = await this.prisma.reinsSource.create({
      data: {
        knowledgeId: data.knowledgeId,
        type: data.type,
        name: data.name,
        url: data.url ?? null,
        mimeType: data.mimeType ?? null,
        content: data.content ?? null,
        sizeBytes: data.sizeBytes ?? null,
      },
    });
    return this.mapper.toSourceEntity(record);
  }

  async setSourceLightragDocId(
    id: string,
    lightragDocId: string,
  ): Promise<IReinsSourceData> {
    const record = await this.prisma.reinsSource.update({
      where: { id },
      data: { lightragDocId },
    });
    return this.mapper.toSourceEntity(record);
  }

  async deleteSource(id: string): Promise<void> {
    await this.prisma.reinsSource.delete({ where: { id } });
  }
}
```

- [ ] **Step 2: Build TypeScript to catch type errors**

Run from `api/`:
```bash
npm run build
```

Expected: build succeeds (generated Prisma client now has `knowledge` and `reinsSource` delegates).

- [ ] **Step 3: Commit**

```bash
git add api/src/slices/reins/data/reins.gateway.ts
git commit -m "feat(reins): add Prisma gateway for Knowledge and ReinsSource"
```

### Task 4.3: Data barrel

**Files:**
- Create: `api/src/slices/reins/data/index.ts`

- [ ] **Step 1: Write barrel**

Create `api/src/slices/reins/data/index.ts`:

```typescript
export * from './reins.mapper';
export * from './reins.gateway';
export * from './lightrag.client';
export * from './lightragHttp.client';
export * from './lightrag.types';
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/data/index.ts
git commit -m "feat(reins): add data barrel export"
```

---

## Phase 5 — Backend: DTOs

### Task 5.1: Knowledge DTOs

**Files:**
- Create: `api/src/slices/reins/dtos/knowledge.dto.ts`
- Create: `api/src/slices/reins/dtos/createKnowledge.dto.ts`
- Create: `api/src/slices/reins/dtos/updateKnowledge.dto.ts`
- Create: `api/src/slices/reins/dtos/filterKnowledge.dto.ts`
- Create: `api/src/slices/reins/dtos/queryKnowledge.dto.ts`
- Create: `api/src/slices/reins/dtos/knowledgeRecord.dto.ts`
- Create: `api/src/slices/reins/dtos/reinsSource.dto.ts`
- Create: `api/src/slices/reins/dtos/createSource.dto.ts`
- Create: `api/src/slices/reins/dtos/index.ts`

- [ ] **Step 1: Create `knowledge.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IKnowledgeData,
  IndexStatusTypes,
} from '../domain/reins.types';
import { ReinsSourceDto } from './reinsSource.dto';

export class KnowledgeDto implements IKnowledgeData {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty() workspace: string;
  @ApiProperty({ type: [String] }) entityTypes: string[];
  @ApiProperty({ type: [String] }) relationshipTypes: string[];
  @ApiProperty({ enum: ['idle', 'indexing', 'ready', 'failed'] })
  indexStatus: IndexStatusTypes;
  @ApiProperty({ type: String, nullable: true }) indexError: string | null;
  @ApiProperty({ type: String, nullable: true }) indexedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) indexStartedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional({ type: [ReinsSourceDto] }) sources?: ReinsSourceDto[];
}
```

- [ ] **Step 2: Create `createKnowledge.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateKnowledgeDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entityTypes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relationshipTypes?: string[];
}
```

- [ ] **Step 3: Create `updateKnowledge.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateKnowledgeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entityTypes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relationshipTypes?: string[];
}
```

- [ ] **Step 4: Create `filterKnowledge.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FilterKnowledgeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;
}
```

- [ ] **Step 5: Create `queryKnowledge.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { QueryModeTypes } from '../domain/reins.types';

const QUERY_MODES: QueryModeTypes[] = ['hybrid', 'local', 'global', 'naive'];

export class QueryKnowledgeDto {
  @ApiProperty()
  @IsString()
  query: string;

  @ApiPropertyOptional({ enum: QUERY_MODES, default: 'hybrid' })
  @IsOptional()
  @IsEnum(QUERY_MODES)
  mode?: QueryModeTypes;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number;
}
```

- [ ] **Step 6: Create `knowledgeRecord.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IKnowledgeQueryRecord } from '../domain/reins.types';

class KnowledgeRecordMetadataDto {
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() source?: string;
  @ApiPropertyOptional() sourceId?: string;
}

export class KnowledgeRecordDto implements IKnowledgeQueryRecord {
  @ApiProperty() pageContent: string;
  @ApiProperty({ type: KnowledgeRecordMetadataDto })
  metadata: KnowledgeRecordMetadataDto;
}
```

- [ ] **Step 7: Create `reinsSource.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IReinsSourceData, SourceTypes } from '../domain/reins.types';

export class ReinsSourceDto implements IReinsSourceData {
  @ApiProperty() id: string;
  @ApiProperty() knowledgeId: string;
  @ApiProperty({ enum: ['file', 'url', 'text'] }) type: SourceTypes;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, nullable: true }) mimeType: string | null;
  @ApiProperty({ type: String, nullable: true }) content: string | null;
  @ApiProperty({ type: Number, nullable: true }) sizeBytes: number | null;
  @ApiProperty({ type: String, nullable: true }) lightragDocId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
```

- [ ] **Step 8: Create `createSource.dto.ts`**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { SourceTypes } from '../domain/reins.types';

const SOURCE_TYPES: SourceTypes[] = ['file', 'url', 'text'];

export class CreateSourceDto {
  @ApiProperty({ enum: SOURCE_TYPES })
  @IsEnum(SOURCE_TYPES)
  type: SourceTypes;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;
}
```

- [ ] **Step 9: Create `index.ts`**

```typescript
export * from './knowledge.dto';
export * from './createKnowledge.dto';
export * from './updateKnowledge.dto';
export * from './filterKnowledge.dto';
export * from './queryKnowledge.dto';
export * from './knowledgeRecord.dto';
export * from './reinsSource.dto';
export * from './createSource.dto';
```

- [ ] **Step 10: Build to verify DTOs compile**

```bash
cd api && npm run build
```

Expected: build succeeds.

- [ ] **Step 11: Commit**

```bash
git add api/src/slices/reins/dtos
git commit -m "feat(reins): add DTOs for knowledge CRUD, sources, and query"
```

---

## Phase 6 — Backend: Service (orchestration + index state machine)

### Task 6.1: Service with unit tests for state machine

**Files:**
- Create: `api/src/slices/reins/domain/reins.service.ts`
- Test: `api/src/slices/reins/domain/reins.service.spec.ts`

The service owns:
1. Index state transitions with a 10-minute staleness watchdog.
2. Incremental ingestion (skip sources with `lightragDocId` already set).
3. Best-effort cascade delete (LightRAG + MinIO failures are logged, not thrown).

For v1, MinIO file fetch during indexing is handled inline via the existing MinIO setup. Since Ranch doesn't yet expose a MinIO gateway for reins use, we add a small helper next. If a Ranch-wide MinIO module later lands, we swap this for it.

- [ ] **Step 1: Write the failing test for state machine: idle → indexing**

Create `api/src/slices/reins/domain/reins.service.spec.ts`:

```typescript
import { ReinsService } from './reins.service';
import { IReinsGateway } from './reins.gateway';
import { ILightragClient } from '../data/lightrag.client';
import {
  IKnowledgeData,
  IReinsSourceData,
} from './reins.types';

type GatewayMock = jest.Mocked<IReinsGateway>;
type ClientMock = jest.Mocked<ILightragClient>;

function makeGateway(): GatewayMock {
  return {
    findAllKnowledge: jest.fn(),
    findKnowledgeById: jest.fn(),
    createKnowledge: jest.fn(),
    updateKnowledge: jest.fn(),
    updateKnowledgeIndexState: jest.fn(),
    deleteKnowledge: jest.fn(),
    findSourcesByKnowledge: jest.fn(),
    findSourceById: jest.fn(),
    createSource: jest.fn(),
    setSourceLightragDocId: jest.fn(),
    deleteSource: jest.fn(),
  } as unknown as GatewayMock;
}

function makeClient(): ClientMock {
  return {
    health: jest.fn(),
    ingestText: jest.fn(),
    ingestUrl: jest.fn(),
    ingestFile: jest.fn(),
    query: jest.fn(),
    deleteDocument: jest.fn(),
    deleteWorkspace: jest.fn(),
  } as unknown as ClientMock;
}

function makeKnowledge(overrides: Partial<IKnowledgeData> = {}): IKnowledgeData {
  return {
    id: 'k1',
    name: 'Test',
    description: null,
    workspace: 'knowledge_k1',
    entityTypes: [],
    relationshipTypes: [],
    indexStatus: 'idle',
    indexError: null,
    indexedAt: null,
    indexStartedAt: null,
    createdAt: new Date('2026-04-23T10:00:00Z'),
    updatedAt: new Date('2026-04-23T10:00:00Z'),
    sources: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<IReinsSourceData> = {}): IReinsSourceData {
  return {
    id: 's1',
    knowledgeId: 'k1',
    type: 'text',
    name: 'Note',
    url: null,
    mimeType: null,
    content: 'Body text',
    sizeBytes: null,
    lightragDocId: null,
    createdAt: new Date('2026-04-23T10:00:00Z'),
    updatedAt: new Date('2026-04-23T10:00:00Z'),
    ...overrides,
  };
}

describe('ReinsService', () => {
  let gateway: GatewayMock;
  let client: ClientMock;
  let service: ReinsService;
  let fileLoader: jest.Mock;

  beforeEach(() => {
    gateway = makeGateway();
    client = makeClient();
    fileLoader = jest.fn();
    service = new ReinsService(gateway, client, {
      loadFile: fileLoader as (url: string) => Promise<Buffer>,
    });
  });

  describe('startIndex', () => {
    it('refuses to start when a fresh index is already running', async () => {
      const running = makeKnowledge({
        indexStatus: 'indexing',
        indexStartedAt: new Date(Date.now() - 60_000),
      });
      gateway.findKnowledgeById.mockResolvedValue(running);
      await expect(service.startIndex('k1')).rejects.toThrow(
        /already indexing/i,
      );
      expect(gateway.updateKnowledgeIndexState).not.toHaveBeenCalled();
    });

    it('restarts a stale indexing run (older than 10 min)', async () => {
      const stale = makeKnowledge({
        indexStatus: 'indexing',
        indexStartedAt: new Date(Date.now() - 11 * 60_000),
      });
      gateway.findKnowledgeById.mockResolvedValue(stale);
      gateway.findSourcesByKnowledge.mockResolvedValue([]);
      gateway.updateKnowledgeIndexState.mockResolvedValue(stale);

      await service.startIndex('k1');

      expect(gateway.updateKnowledgeIndexState).toHaveBeenCalledWith(
        'k1',
        expect.objectContaining({ indexStatus: 'indexing' }),
      );
    });

    it('transitions idle → indexing → ready on successful run', async () => {
      const k = makeKnowledge({ indexStatus: 'idle' });
      const src = makeSource({ content: 'hello', type: 'text' });
      gateway.findKnowledgeById.mockResolvedValue(k);
      gateway.findSourcesByKnowledge.mockResolvedValue([src]);
      gateway.updateKnowledgeIndexState.mockResolvedValue(k);
      gateway.setSourceLightragDocId.mockResolvedValue({
        ...src,
        lightragDocId: 'doc-1',
      });
      client.ingestText.mockResolvedValue({ docId: 'doc-1' });

      await service.startIndex('k1');
      await service.waitForIndex('k1');

      const statuses = gateway.updateKnowledgeIndexState.mock.calls.map(
        ([, patch]) => patch.indexStatus,
      );
      expect(statuses).toEqual(['indexing', 'ready']);
      expect(client.ingestText).toHaveBeenCalledWith({
        workspace: 'knowledge_k1',
        text: 'hello',
        fileSource: 'Note',
      });
      expect(gateway.setSourceLightragDocId).toHaveBeenCalledWith('s1', 'doc-1');
    });

    it('skips sources that already have a lightragDocId (incremental)', async () => {
      const k = makeKnowledge();
      const already = makeSource({ lightragDocId: 'doc-old' });
      const fresh = makeSource({ id: 's2', content: 'new text' });
      gateway.findKnowledgeById.mockResolvedValue(k);
      gateway.findSourcesByKnowledge.mockResolvedValue([already, fresh]);
      gateway.updateKnowledgeIndexState.mockResolvedValue(k);
      client.ingestText.mockResolvedValue({ docId: 'doc-new' });
      gateway.setSourceLightragDocId.mockResolvedValue(fresh);

      await service.startIndex('k1');
      await service.waitForIndex('k1');

      expect(client.ingestText).toHaveBeenCalledTimes(1);
      expect(client.ingestText).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'new text' }),
      );
    });

    it('transitions to failed and records error when ingest throws', async () => {
      const k = makeKnowledge();
      const src = makeSource({ content: 'x' });
      gateway.findKnowledgeById.mockResolvedValue(k);
      gateway.findSourcesByKnowledge.mockResolvedValue([src]);
      gateway.updateKnowledgeIndexState.mockResolvedValue(k);
      client.ingestText.mockRejectedValue(new Error('boom'));

      await service.startIndex('k1');
      await service.waitForIndex('k1');

      const last = gateway.updateKnowledgeIndexState.mock.calls.at(-1)!;
      expect(last[1].indexStatus).toBe('failed');
      expect(last[1].indexError).toContain('boom');
    });
  });

  describe('deleteKnowledge', () => {
    it('deletes from Ranch even if LightRAG deleteWorkspace fails', async () => {
      const k = makeKnowledge();
      gateway.findKnowledgeById.mockResolvedValue(k);
      client.deleteWorkspace.mockRejectedValue(new Error('lightrag down'));

      await service.deleteKnowledge('k1');

      expect(gateway.deleteKnowledge).toHaveBeenCalledWith('k1');
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
cd api && npx jest reins/domain/reins.service.spec.ts
```

Expected: FAIL with "Cannot find module `./reins.service`".

- [ ] **Step 3: Write service implementation**

Create `api/src/slices/reins/domain/reins.service.ts`:

```typescript
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IReinsGateway } from './reins.gateway';
import {
  IKnowledgeData,
  ICreateKnowledgeData,
  IUpdateKnowledgeData,
  IReinsSourceData,
  ICreateSourceData,
  IKnowledgeQueryRecord,
  QueryModeTypes,
} from './reins.types';
import { ILightragClient } from '../data/lightrag.client';

const STALE_INDEX_AFTER_MS = 10 * 60 * 1000;

export interface IFileLoader {
  loadFile(url: string): Promise<Buffer>;
}

@Injectable()
export class ReinsService {
  private readonly logger = new Logger(ReinsService.name);
  private readonly inflightIndexing = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: IReinsGateway,
    private readonly client: ILightragClient,
    private readonly fileLoader: IFileLoader,
  ) {}

  listKnowledge(): Promise<IKnowledgeData[]> {
    return this.gateway.findAllKnowledge();
  }

  async getKnowledge(id: string): Promise<IKnowledgeData> {
    const k = await this.gateway.findKnowledgeById(id);
    if (!k) throw new NotFoundException(`Knowledge ${id} not found`);
    return k;
  }

  createKnowledge(data: ICreateKnowledgeData): Promise<IKnowledgeData> {
    return this.gateway.createKnowledge(data);
  }

  async updateKnowledge(
    id: string,
    data: IUpdateKnowledgeData,
  ): Promise<IKnowledgeData> {
    await this.getKnowledge(id);
    return this.gateway.updateKnowledge(id, data);
  }

  async deleteKnowledge(id: string): Promise<void> {
    const k = await this.getKnowledge(id);
    try {
      await this.client.deleteWorkspace(k.workspace);
    } catch (err) {
      this.logger.warn(
        `LightRAG deleteWorkspace(${k.workspace}) failed: ${(err as Error).message}`,
      );
    }
    await this.gateway.deleteKnowledge(id);
  }

  listSources(knowledgeId: string): Promise<IReinsSourceData[]> {
    return this.gateway.findSourcesByKnowledge(knowledgeId);
  }

  async addSource(data: ICreateSourceData): Promise<IReinsSourceData> {
    return this.gateway.createSource(data);
  }

  async deleteSource(id: string): Promise<void> {
    const source = await this.gateway.findSourceById(id);
    if (!source) throw new NotFoundException(`Source ${id} not found`);
    if (source.lightragDocId) {
      const k = await this.gateway.findKnowledgeById(source.knowledgeId);
      if (k) {
        try {
          await this.client.deleteDocument(k.workspace, source.lightragDocId);
        } catch (err) {
          this.logger.warn(
            `LightRAG deleteDocument failed for source ${id}: ${(err as Error).message}`,
          );
        }
      }
    }
    await this.gateway.deleteSource(id);
  }

  async startIndex(knowledgeId: string): Promise<void> {
    const k = await this.getKnowledge(knowledgeId);

    if (k.indexStatus === 'indexing' && k.indexStartedAt) {
      const ageMs = Date.now() - k.indexStartedAt.getTime();
      if (ageMs < STALE_INDEX_AFTER_MS) {
        throw new Error(
          `Knowledge ${knowledgeId} already indexing (started ${Math.round(ageMs / 1000)}s ago)`,
        );
      }
      this.logger.warn(
        `Knowledge ${knowledgeId} has stale indexing state — restarting`,
      );
    }

    await this.gateway.updateKnowledgeIndexState(knowledgeId, {
      indexStatus: 'indexing',
      indexStartedAt: new Date(),
      indexError: null,
    });

    const task = this.runIndex(knowledgeId, k.workspace);
    this.inflightIndexing.set(knowledgeId, task);
    task.finally(() => {
      if (this.inflightIndexing.get(knowledgeId) === task) {
        this.inflightIndexing.delete(knowledgeId);
      }
    });
  }

  /** Test helper — resolves when the current indexing run finishes. */
  async waitForIndex(knowledgeId: string): Promise<void> {
    const task = this.inflightIndexing.get(knowledgeId);
    if (task) await task;
  }

  private async runIndex(knowledgeId: string, workspace: string): Promise<void> {
    try {
      const sources = await this.gateway.findSourcesByKnowledge(knowledgeId);
      for (const source of sources) {
        if (source.lightragDocId) continue;
        await this.ingestSource(source, workspace);
      }
      await this.gateway.updateKnowledgeIndexState(knowledgeId, {
        indexStatus: 'ready',
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (err) {
      this.logger.error(
        `Indexing failed for knowledge ${knowledgeId}: ${(err as Error).message}`,
      );
      await this.gateway.updateKnowledgeIndexState(knowledgeId, {
        indexStatus: 'failed',
        indexError: (err as Error).message,
      });
    }
  }

  private async ingestSource(
    source: IReinsSourceData,
    workspace: string,
  ): Promise<void> {
    if (source.type === 'text') {
      if (!source.content) {
        throw new Error(`Source ${source.id} has no content`);
      }
      const res = await this.client.ingestText({
        workspace,
        text: source.content,
        fileSource: source.name,
      });
      await this.gateway.setSourceLightragDocId(source.id, res.docId);
      return;
    }
    if (source.type === 'url') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const res = await this.client.ingestUrl({ workspace, url: source.url });
      await this.gateway.setSourceLightragDocId(source.id, res.docId);
      return;
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const buffer = await this.fileLoader.loadFile(source.url);
      const res = await this.client.ingestFile({
        workspace,
        filename: source.name,
        mimeType: source.mimeType ?? 'application/octet-stream',
        content: buffer,
      });
      await this.gateway.setSourceLightragDocId(source.id, res.docId);
      return;
    }
    throw new Error(`Unknown source type: ${source.type as string}`);
  }

  async query(
    knowledgeId: string,
    query: string,
    mode?: QueryModeTypes,
    topK?: number,
  ): Promise<IKnowledgeQueryRecord[]> {
    const k = await this.getKnowledge(knowledgeId);
    return this.client.query({
      workspace: k.workspace,
      query,
      mode,
      topK,
    });
  }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
cd api && npx jest reins/domain/reins.service.spec.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/slices/reins/domain/reins.service.ts api/src/slices/reins/domain/reins.service.spec.ts
git commit -m "feat(reins): add service with index state machine and incremental ingest"
```

### Task 6.2: Update domain barrel to include service

**Files:**
- Modify: `api/src/slices/reins/domain/index.ts`

- [ ] **Step 1: Edit barrel**

Replace `api/src/slices/reins/domain/index.ts`:

```typescript
export * from './reins.types';
export * from './reins.gateway';
export * from './reins.service';
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/domain/index.ts
git commit -m "chore(reins): export service from domain barrel"
```

---

## Phase 7 — Backend: MinIO file loader

Reuse the existing MinIO setup. `minio-init` already creates the bucket `ranch-agent-data`. Add a second bucket `ranch-reins-sources` for uploaded knowledge sources and a small loader wrapper inside reins.

### Task 7.1: Add MinIO bucket init entry

**Files:**
- Modify: `api/docker-compose.yml`

- [ ] **Step 1: Update minio-init to create the reins bucket**

Open `api/docker-compose.yml` and locate the `minio-init` service. Replace its `entrypoint` block with the two-bucket version:

```yaml
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin;
      mc mb local/ranch-agent-data --ignore-existing;
      mc mb local/ranch-reins-sources --ignore-existing;
      exit 0;
      "
```

- [ ] **Step 2: Bounce minio-init to apply**

```bash
docker compose -f api/docker-compose.yml up -d minio-init
docker compose -f api/docker-compose.yml logs minio-init --tail=10
```

Expected: log shows `Bucket created successfully local/ranch-reins-sources`.

- [ ] **Step 3: Commit**

```bash
git add api/docker-compose.yml
git commit -m "feat(reins): create MinIO bucket ranch-reins-sources"
```

### Task 7.2: MinIO file loader inside reins

**Files:**
- Create: `api/src/slices/reins/data/minio.fileLoader.ts`

For v1 we use a minimal inline implementation: files uploaded via the controller are stored as base64 blobs in MinIO using the AWS SDK (already in use elsewhere in Ranch). If Ranch doesn't yet have an AWS SDK dep, install it in Step 1.

- [ ] **Step 1: Ensure AWS SDK is installed**

Run from `api/`:
```bash
cd api && npm ls @aws-sdk/client-s3
```

If missing, install:
```bash
npm install @aws-sdk/client-s3
```

- [ ] **Step 2: Write the file loader**

Create `api/src/slices/reins/data/minio.fileLoader.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { IFileLoader } from '../domain/reins.service';

export interface MinioConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

@Injectable()
export class MinioFileLoader implements IFileLoader {
  private readonly logger = new Logger(MinioFileLoader.name);
  private readonly client: S3Client;
  readonly bucket: string;
  readonly endpoint: string;

  constructor(config: MinioConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
    this.endpoint = config.endpoint;
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async loadFile(url: string): Promise<Buffer> {
    const key = this.keyFromUrl(url);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`MinIO: empty body for ${url}`);
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(url: string): Promise<void> {
    const key = this.keyFromUrl(url);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `MinIO delete failed for ${url}: ${(err as Error).message}`,
      );
    }
  }

  private keyFromUrl(url: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!url.startsWith(prefix)) {
      throw new Error(`MinIO: unexpected url shape ${url}`);
    }
    return url.slice(prefix.length);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/slices/reins/data/minio.fileLoader.ts api/package.json api/bun.lock
git commit -m "feat(reins): add MinIO file loader for source uploads"
```

---

## Phase 8 — Backend: Controller

### Task 8.1: Controller

**Files:**
- Create: `api/src/slices/reins/reins.controller.ts`

- [ ] **Step 1: Write controller**

Create `api/src/slices/reins/reins.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ReinsService } from './domain/reins.service';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  FilterKnowledgeDto,
  QueryKnowledgeDto,
  CreateSourceDto,
} from './dtos';
import { MinioFileLoader } from './data/minio.fileLoader';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('reins')
@Controller('knowledges')
export class ReinsController {
  constructor(
    private readonly service: ReinsService,
    private readonly minio: MinioFileLoader,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List knowledges', operationId: 'getKnowledges' })
  list(@Query() _filter: FilterKnowledgeDto) {
    return this.service.listKnowledge();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one knowledge', operationId: 'getKnowledge' })
  async getOne(@Param('id') id: string) {
    return this.service.getKnowledge(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create knowledge', operationId: 'createKnowledge' })
  create(@Body() dto: CreateKnowledgeDto) {
    return this.service.createKnowledge(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update knowledge', operationId: 'updateKnowledge' })
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDto) {
    return this.service.updateKnowledge(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete knowledge', operationId: 'deleteKnowledge' })
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.service.deleteKnowledge(id);
  }

  @Post(':id/index')
  @ApiOperation({
    summary: 'Start indexing',
    operationId: 'indexKnowledge',
  })
  @HttpCode(202)
  async startIndex(@Param('id') id: string) {
    await this.service.startIndex(id);
    return { ok: true };
  }

  @Get(':id/records')
  @ApiOperation({
    summary: 'Query knowledge',
    operationId: 'getKnowledgeRecords',
  })
  async query(@Param('id') id: string, @Query() dto: QueryKnowledgeDto) {
    return this.service.query(id, dto.query, dto.mode, dto.topK);
  }

  @Get(':id/sources')
  @ApiOperation({
    summary: 'List sources',
    operationId: 'getKnowledgeSources',
  })
  listSources(@Param('id') id: string) {
    return this.service.listSources(id);
  }

  @Post(':id/sources')
  @ApiOperation({
    summary: 'Add source (file|url|text)',
    operationId: 'addKnowledgeSource',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('file'))
  async addSource(
    @Param('id') id: string,
    @Body() dto: CreateSourceDto,
    @UploadedFile() file?: UploadedFileLike,
  ) {
    await this.service.getKnowledge(id);

    if (dto.type === 'file') {
      if (!file) throw new BadRequestException('file is required when type=file');
      const key = `${id}/${crypto.randomUUID()}-${file.originalname}`;
      const url = await this.minio.upload(key, file.buffer, file.mimetype);
      return this.service.addSource({
        knowledgeId: id,
        type: 'file',
        name: file.originalname,
        url,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });
    }

    if (dto.type === 'url') {
      if (!dto.url) throw new BadRequestException('url is required when type=url');
      return this.service.addSource({
        knowledgeId: id,
        type: 'url',
        name: dto.name,
        url: dto.url,
      });
    }

    if (dto.type === 'text') {
      if (!dto.content)
        throw new BadRequestException('content is required when type=text');
      return this.service.addSource({
        knowledgeId: id,
        type: 'text',
        name: dto.name,
        content: dto.content,
      });
    }

    throw new BadRequestException(`Unknown source type: ${dto.type as string}`);
  }

  @Delete(':id/sources/:sourceId')
  @ApiOperation({
    summary: 'Delete source',
    operationId: 'deleteKnowledgeSource',
  })
  @HttpCode(204)
  async removeSource(
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
  ) {
    const source = await this.service
      .listSources(id)
      .then((list) => list.find((s) => s.id === sourceId));
    if (!source) throw new NotFoundException(`Source ${sourceId} not found`);
    if (source.url && source.type === 'file') {
      await this.minio.delete(source.url);
    }
    await this.service.deleteSource(sourceId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/slices/reins/reins.controller.ts
git commit -m "feat(reins): add HTTP controller for knowledges and sources"
```

---

## Phase 9 — Backend: Module wiring

### Task 9.1: Reins module

**Files:**
- Create: `api/src/slices/reins/reins.module.ts`
- Create: `api/src/slices/reins/index.ts`

- [ ] **Step 1: Write module**

Create `api/src/slices/reins/reins.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '#/setup/prisma/prisma.module';
import { ReinsController } from './reins.controller';
import { IReinsGateway } from './domain/reins.gateway';
import { ReinsGateway } from './data/reins.gateway';
import { ReinsMapper } from './data/reins.mapper';
import { ReinsService } from './domain/reins.service';
import { ILightragClient } from './data/lightrag.client';
import { LightragHttpClient } from './data/lightragHttp.client';
import { MinioFileLoader } from './data/minio.fileLoader';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [ReinsController],
  providers: [
    ReinsMapper,
    { provide: IReinsGateway, useClass: ReinsGateway },
    {
      provide: MinioFileLoader,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MinioFileLoader({
          endpoint: config.get<string>('MINIO_ENDPOINT', 'http://localhost:9000'),
          region: config.get<string>('MINIO_REGION', 'us-east-1'),
          accessKeyId: config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
          secretAccessKey: config.get<string>(
            'MINIO_SECRET_KEY',
            'minioadmin',
          ),
          bucket: config.get<string>(
            'MINIO_REINS_BUCKET',
            'ranch-reins-sources',
          ),
        }),
    },
    {
      provide: ILightragClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LightragHttpClient({
          baseUrl: config.get<string>('LIGHTRAG_URL', 'http://localhost:9621'),
          apiKey: config.get<string>('LIGHTRAG_API_KEY', 'dev-secret-change-me'),
        }),
    },
    {
      provide: ReinsService,
      inject: [IReinsGateway, ILightragClient, MinioFileLoader],
      useFactory: (
        gateway: IReinsGateway,
        client: ILightragClient,
        loader: MinioFileLoader,
      ) => new ReinsService(gateway, client, loader),
    },
  ],
  exports: [ReinsService],
})
export class ReinsModule {}
```

- [ ] **Step 2: Write barrel**

Create `api/src/slices/reins/index.ts`:

```typescript
export { ReinsModule } from './reins.module';
export { ReinsController } from './reins.controller';
export * from './domain';
export * from './dtos';
```

- [ ] **Step 3: Commit**

```bash
git add api/src/slices/reins/reins.module.ts api/src/slices/reins/index.ts
git commit -m "feat(reins): add NestJS module wiring"
```

### Task 9.2: Register reins in app.module

**Files:**
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Add import and register**

Open `api/src/app.module.ts` and:

1. After the existing `import { UsageModule } ...` line, add:
```typescript
import { ReinsModule } from './slices/reins/reins.module';
```

2. In the `imports:` array, after `UsageModule,`, add:
```typescript
    ReinsModule,
```

- [ ] **Step 2: Start the API and hit Swagger**

Run from `api/`:
```bash
npm run dev
```

Open `http://localhost:3000/api` in a browser. Expected: see new `reins` tag with all knowledge endpoints.

Stop the dev server (`Ctrl+C`).

- [ ] **Step 3: Commit**

```bash
git add api/src/app.module.ts
git commit -m "feat(reins): register ReinsModule in app.module"
```

---

## Phase 10 — Infrastructure: docker-compose for LightRAG

### Task 10.1: Add LightRAG + its Postgres to docker-compose

**Files:**
- Modify: `api/docker-compose.yml`

- [ ] **Step 1: Append services under the `services:` block**

In `api/docker-compose.yml`, add two new services **after `minio-init`** (keep indentation consistent at 2 spaces):

```yaml
  lightrag-postgres:
    image: shangor/postgres-for-rag:v1.0
    container_name: ranch-lightrag-postgres
    ports:
      - '5433:5432'
    environment:
      POSTGRES_USER: lightrag
      POSTGRES_PASSWORD: lightrag
      POSTGRES_DB: lightrag
    volumes:
      - ./docker/lightrag-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U lightrag']
      interval: 5s
      timeout: 5s
      retries: 5

  lightrag:
    image: ghcr.io/hkuds/lightrag:latest
    container_name: ranch-lightrag
    ports:
      - '9621:9621'
    environment:
      LIGHTRAG_API_KEY: ${LIGHTRAG_API_KEY:-dev-secret-change-me}
      LLM_BINDING: openai
      LLM_MODEL: gpt-4o-mini
      LLM_BINDING_API_KEY: ${OPENAI_API_KEY}
      EMBEDDING_BINDING: openai
      EMBEDDING_MODEL: text-embedding-3-small
      EMBEDDING_BINDING_API_KEY: ${OPENAI_API_KEY}
      POSTGRES_HOST: lightrag-postgres
      POSTGRES_PORT: 5432
      POSTGRES_USER: lightrag
      POSTGRES_PASSWORD: lightrag
      POSTGRES_DATABASE: lightrag
      LIGHTRAG_KV_STORAGE: PGKVStorage
      LIGHTRAG_DOC_STATUS_STORAGE: PGDocStatusStorage
      LIGHTRAG_VECTOR_STORAGE: PGVectorStorage
      LIGHTRAG_GRAPH_STORAGE: PGGraphStorage
    depends_on:
      lightrag-postgres:
        condition: service_healthy
    volumes:
      - ./docker/lightrag-data:/app/data/rag_storage
      - ./docker/lightrag-inputs:/app/data/inputs
```

- [ ] **Step 2: Bring up the new services**

```bash
docker compose -f api/docker-compose.yml up -d lightrag-postgres lightrag
docker compose -f api/docker-compose.yml logs lightrag --tail=50 -f
```

Wait until LightRAG logs `Uvicorn running on http://0.0.0.0:9621`. Hit `Ctrl+C` to stop following logs.

- [ ] **Step 3: Smoke-test LightRAG health**

```bash
curl -s -H "x-api-key: dev-secret-change-me" http://localhost:9621/health
```

Expected: JSON with `"status":"ok"` or similar.

- [ ] **Step 4: Commit**

```bash
git add api/docker-compose.yml
git commit -m "feat(reins): add LightRAG + lightrag-postgres services to docker-compose"
```

### Task 10.2: Env variables for reins

**Files:**
- Modify: `api/.env.dev` (local; NOT committed)
- Modify: `api/.env.example` (if exists; committed)

- [ ] **Step 1: Add keys to `api/.env.dev`**

Append to `api/.env.dev` (or create if missing):

```
LIGHTRAG_URL=http://localhost:9621
LIGHTRAG_API_KEY=dev-secret-change-me
OPENAI_API_KEY=sk-replace-me
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_REINS_BUCKET=ranch-reins-sources
```

- [ ] **Step 2: If `.env.example` exists, mirror the keys there with placeholders**

```
LIGHTRAG_URL=http://localhost:9621
LIGHTRAG_API_KEY=changeme
OPENAI_API_KEY=
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_REINS_BUCKET=ranch-reins-sources
```

Check existence:
```bash
ls api/.env.example 2>/dev/null && echo "exists" || echo "missing"
```
If it exists, edit it. Otherwise skip.

- [ ] **Step 3: Commit (only if `.env.example` was edited)**

```bash
git add api/.env.example
git commit -m "chore(reins): document LightRAG + MinIO env vars in .env.example"
```

If `.env.example` is absent in this repo, skip this commit.

### Task 10.3: Makefile helper

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add log shortcut**

Open the root `Makefile`. In the section with other helper targets (look for `db` or `db-stop` style targets), add:

```makefile
lightrag-logs:
	docker compose -f api/docker-compose.yml logs -f lightrag
```

- [ ] **Step 2: Commit**

```bash
git add Makefile
git commit -m "chore(reins): add lightrag-logs make target"
```

### Task 10.4: End-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Restart the API with LightRAG up**

```bash
cd api && npm run dev
```

- [ ] **Step 2: Create a knowledge via Swagger or curl**

```bash
curl -s -X POST http://localhost:3000/knowledges \
  -H "content-type: application/json" \
  -d '{"name":"smoke","description":"hello"}'
```

Expected: 201/200 with `id`, `workspace: knowledge_<hex>`, `indexStatus: idle`.

- [ ] **Step 3: Add a text source**

Replace `<id>` with the id from Step 2:
```bash
curl -s -X POST http://localhost:3000/knowledges/<id>/sources \
  -H "content-type: application/json" \
  -d '{"type":"text","name":"note1","content":"The sun is a star."}'
```

- [ ] **Step 4: Kick off indexing**

```bash
curl -s -X POST http://localhost:3000/knowledges/<id>/index
```

Expected: 202 and `{ ok: true }`.

- [ ] **Step 5: Poll status until ready**

```bash
curl -s http://localhost:3000/knowledges/<id> | grep indexStatus
```

Expected within ~30s: `"indexStatus":"ready"`. If it stays `indexing` longer than 2 minutes, check `make lightrag-logs`.

- [ ] **Step 6: Query**

```bash
curl -s -G http://localhost:3000/knowledges/<id>/records \
  --data-urlencode 'query=What is the sun?'
```

Expected: an array with at least one record whose `pageContent` mentions "star".

Stop the dev server (`Ctrl+C`). No commit — this is verification only.

---

## Phase 11 — Admin UI: Slice scaffold

### Task 11.1: Admin slice boilerplate

**Files:**
- Create: `admin/slices/reins/nuxt.config.ts`
- Create: `admin/slices/reins/pages.ts`
- Create: `admin/slices/reins/i18n/locales/en.json`
- Create: `admin/slices/reins/locales/en.json`
- Create: `admin/slices/reins/plugins/menu.ts`

- [ ] **Step 1: Create `nuxt.config.ts`**

```typescript
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: { '#reins': currentDir },
  imports: {
    dirs: [`${currentDir}/stores`],
  },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: 'locales',
    locales: [{ code: 'en', file: 'en.json' }],
  },
});
```

- [ ] **Step 2: Create `pages.ts`**

```typescript
export const pages = {
  knowledges: 'knowledges',
  knowledgesCreate: 'knowledges-create',
  knowledgesEdit: 'knowledges-id-edit',
  knowledgesSources: 'knowledges-id-sources',
  knowledgesGraph: 'knowledges-id-graph',
  knowledgesQuery: 'knowledges-id-query',
};
```

- [ ] **Step 3: Create `i18n/locales/en.json`**

```json
{
  "reins": {
    "title": "Knowledge",
    "subtitle": "RAG knowledge bases backed by LightRAG"
  }
}
```

- [ ] **Step 4: Create `locales/en.json`** (empty stub mirrors llm slice convention)

```json
{}
```

- [ ] **Step 5: Create `plugins/menu.ts`**

```typescript
import { MenuGroupTypes, useMenuStore } from '#common/stores/menu';

export default defineNuxtPlugin(() => {
  const menu = useMenuStore();

  menu.addSidebar({
    id: 'reins',
    group: MenuGroupTypes.Admin,
    title: 'Knowledge',
    link: 'knowledges',
    active: false,
    icon: 'Database',
    sortOrder: 20,
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add admin/slices/reins/nuxt.config.ts admin/slices/reins/pages.ts admin/slices/reins/i18n admin/slices/reins/locales admin/slices/reins/plugins
git commit -m "feat(admin-reins): slice scaffold with i18n + sidebar menu"
```

---

## Phase 12 — Admin UI: Regenerate API SDK

The hey-api-generated SDK under `admin/slices/setup/api/data/repositories/api/` must pick up the new `/knowledges/*` endpoints.

### Task 12.1: Regenerate SDK

**Files:**
- Auto-generated: `admin/slices/setup/api/data/repositories/api/*.gen.ts`

- [ ] **Step 1: Start the API**

```bash
cd api && npm run dev
```

Wait until it's up and `http://localhost:3000/api-json` responds.

- [ ] **Step 2: Regenerate the admin SDK**

In another terminal:
```bash
cd admin && npx @hey-api/openapi-ts
```

(Uses `admin/openapi-ts.config.ts`.) Expected: `*.gen.ts` files under `admin/slices/setup/api/` get updated; git shows changes include `ReinsService` or similar exports.

- [ ] **Step 3: Verify generated service exists**

```bash
grep -l "knowledges" admin/slices/setup/api/data/repositories/api/*.gen.ts
```

Expected: at least one hit.

- [ ] **Step 4: Commit**

```bash
git add admin/slices/setup/api/data/repositories/api
git commit -m "chore(admin): regenerate API SDK for reins endpoints"
```

Stop the API server (`Ctrl+C`).

---

## Phase 13 — Admin UI: Pinia store

### Task 13.1: Store

**Files:**
- Create: `admin/slices/reins/stores/knowledge.ts`

- [ ] **Step 1: Write the store**

Create `admin/slices/reins/stores/knowledge.ts`:

```typescript
import { ReinsService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'failed';
export type SourceType = 'file' | 'url' | 'text';

export interface IKnowledge {
  id: string;
  name: string;
  description: string | null;
  workspace: string;
  entityTypes: string[];
  relationshipTypes: string[];
  indexStatus: IndexStatus;
  indexError: string | null;
  indexedAt: string | null;
  indexStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sources?: IReinsSource[];
}

export interface IReinsSource {
  id: string;
  knowledgeId: string;
  type: SourceType;
  name: string;
  url: string | null;
  mimeType: string | null;
  content: string | null;
  sizeBytes: number | null;
  lightragDocId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateKnowledgeInput {
  name: string;
  description?: string;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IUpdateKnowledgeInput {
  name?: string;
  description?: string | null;
  entityTypes?: string[];
  relationshipTypes?: string[];
}

export interface IQueryRecord {
  pageContent: string;
  metadata: {
    title?: string;
    source?: string;
    sourceId?: string;
  };
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as ApiEnvelope<T>)) {
    return ((body as ApiEnvelope<T>).data ?? null) as T | null;
  }
  return (body ?? null) as T | null;
}

export const useKnowledgeStore = defineStore('reins-knowledge', () => {
  const items = ref<IKnowledge[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await ReinsService.reinsControllerList();
      items.value = unwrap<IKnowledge[]>(res.data) ?? [];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
    return items.value;
  }

  async function fetchById(id: string) {
    const res = await ReinsService.reinsControllerGetOne({ path: { id } });
    return unwrap<IKnowledge>(res.data);
  }

  async function create(body: ICreateKnowledgeInput) {
    const res = await ReinsService.reinsControllerCreate({ body });
    const created = unwrap<IKnowledge>(res.data);
    if (created) items.value.unshift(created);
    return created;
  }

  async function update(id: string, body: IUpdateKnowledgeInput) {
    const res = await ReinsService.reinsControllerUpdate({ path: { id }, body });
    const updated = unwrap<IKnowledge>(res.data);
    if (updated) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, updated);
    }
    return updated;
  }

  async function remove(id: string) {
    await ReinsService.reinsControllerRemove({ path: { id } });
    items.value = items.value.filter((x) => x.id !== id);
  }

  async function startIndex(id: string) {
    await ReinsService.reinsControllerStartIndex({ path: { id } });
    const fresh = await fetchById(id);
    if (fresh) {
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value.splice(idx, 1, fresh);
    }
    return fresh;
  }

  async function query(id: string, q: string, mode = 'hybrid', topK = 25) {
    const res = await ReinsService.reinsControllerQuery({
      path: { id },
      query: { query: q, mode, topK },
    });
    return unwrap<IQueryRecord[]>(res.data) ?? [];
  }

  async function listSources(id: string) {
    const res = await ReinsService.reinsControllerListSources({ path: { id } });
    return unwrap<IReinsSource[]>(res.data) ?? [];
  }

  async function addTextSource(id: string, name: string, content: string) {
    const res = await ReinsService.reinsControllerAddSource({
      path: { id },
      body: { type: 'text', name, content },
    });
    return unwrap<IReinsSource>(res.data);
  }

  async function addUrlSource(id: string, name: string, url: string) {
    const res = await ReinsService.reinsControllerAddSource({
      path: { id },
      body: { type: 'url', name, url },
    });
    return unwrap<IReinsSource>(res.data);
  }

  async function addFileSource(id: string, file: File) {
    const form = new FormData();
    form.append('type', 'file');
    form.append('name', file.name);
    form.append('file', file);
    const res = await $fetch<unknown>(`/api/knowledges/${id}/sources`, {
      method: 'POST',
      body: form,
    });
    return unwrap<IReinsSource>(res);
  }

  async function removeSource(id: string, sourceId: string) {
    await ReinsService.reinsControllerRemoveSource({
      path: { id, sourceId },
    });
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    startIndex,
    query,
    listSources,
    addTextSource,
    addUrlSource,
    addFileSource,
    removeSource,
  };
});
```

> If generated method names from hey-api differ (e.g. `reinsControllerFindOne` vs `reinsControllerGetOne`), match the actual exports in `admin/slices/setup/api/data/repositories/api/sdk.gen.ts` after Phase 12. Rename inline in this store.

- [ ] **Step 2: Commit**

```bash
git add admin/slices/reins/stores/knowledge.ts
git commit -m "feat(admin-reins): Pinia store for knowledge CRUD + sources + query"
```

---

## Phase 14 — Admin UI: List page

### Task 14.1: List components

**Files:**
- Create: `admin/slices/reins/components/knowledge/IndexStatusBadge.vue`
- Create: `admin/slices/reins/components/knowledgeList/Provider.vue`
- Create: `admin/slices/reins/pages/knowledges/index.vue`

- [ ] **Step 1: Create `IndexStatusBadge.vue`**

```vue
<script setup lang="ts">
import type { IndexStatus } from '#reins/stores/knowledge';

const props = defineProps<{ status: IndexStatus }>();

const label = computed(() => {
  switch (props.status) {
    case 'idle':
      return 'Idle';
    case 'indexing':
      return 'Indexing…';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return props.status;
  }
});

const variant = computed(() => {
  switch (props.status) {
    case 'ready':
      return 'default';
    case 'indexing':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
});
</script>

<template>
  <Badge :variant="variant">{{ label }}</Badge>
</template>
```

- [ ] **Step 2: Create `knowledgeList/Provider.vue`**

```vue
<script setup lang="ts">
import { DateTime } from 'luxon';
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-vue';

const store = useKnowledgeStore();

const search = ref('');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return store.items;
  return store.items.filter(
    (k) =>
      k.name.toLowerCase().includes(q) ||
      (k.description ?? '').toLowerCase().includes(q),
  );
});

onMounted(() => {
  store.fetchAll();
});

async function handleDelete(id: string) {
  await store.remove(id);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Knowledge</h1>
        <p class="text-sm text-muted-foreground">
          Knowledge bases backed by LightRAG. Create one, add sources, and index.
        </p>
      </div>
      <NuxtLink to="/knowledges/create">
        <Button>
          <IconPlus class="size-4 mr-1" /> New knowledge
        </Button>
      </NuxtLink>
    </div>

    <Input v-model="search" placeholder="Search" class="max-w-sm" />

    <div v-if="store.loading" class="text-sm text-muted-foreground">Loading…</div>
    <div v-else-if="store.error" class="text-sm text-destructive">{{ store.error }}</div>

    <div v-else-if="filtered.length === 0" class="text-sm text-muted-foreground">
      No knowledge bases yet.
    </div>

    <div v-else class="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Sources</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in filtered" :key="item.id">
            <TableCell class="font-medium">{{ item.name }}</TableCell>
            <TableCell>{{ item.sources?.length ?? 0 }}</TableCell>
            <TableCell>
              <IndexStatusBadge :status="item.indexStatus" />
            </TableCell>
            <TableCell>
              {{ DateTime.fromISO(item.updatedAt).toFormat('yyyy-LL-dd HH:mm') }}
            </TableCell>
            <TableCell class="text-right">
              <NuxtLink :to="`/knowledges/${item.id}/edit`">
                <Button size="sm" variant="ghost">
                  <IconPencil class="size-4" />
                </Button>
              </NuxtLink>
              <Confirm @confirm="handleDelete(item.id)">
                <Button size="sm" variant="ghost">
                  <IconTrash class="size-4" />
                </Button>
              </Confirm>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
```

> If `Confirm` or `Badge` component names differ in Ranch admin, replace with the actual ones (check `admin/slices/common/components/`). LLM slice pages are a good reference.

- [ ] **Step 3: Create `pages/knowledges/index.vue`**

```vue
<template>
  <KnowledgeListProvider />
</template>
```

- [ ] **Step 4: Run admin in dev and verify page renders**

```bash
cd admin && npm run dev
```

Open `http://localhost:3002/knowledges`. Expected: table shows the `smoke` knowledge created in Phase 10 Task 10.4 (or empty state if you deleted it). Stop with `Ctrl+C`.

- [ ] **Step 5: Commit**

```bash
git add admin/slices/reins/components/knowledge/IndexStatusBadge.vue admin/slices/reins/components/knowledgeList admin/slices/reins/pages/knowledges/index.vue
git commit -m "feat(admin-reins): knowledge list page"
```

---

## Phase 15 — Admin UI: Create page

### Task 15.1: Create form + page

**Files:**
- Create: `admin/slices/reins/components/knowledge/Form.vue`
- Create: `admin/slices/reins/components/knowledgeCreate/Provider.vue`
- Create: `admin/slices/reins/pages/knowledges/create.vue`

- [ ] **Step 1: Create `Form.vue`**

```vue
<script setup lang="ts">
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import * as z from 'zod';

const props = defineProps<{
  initial?: { name: string; description?: string | null };
  submitting: boolean;
  submitLabel: string;
}>();

const emits = defineEmits<{
  (e: 'submit', value: { name: string; description?: string }): void;
  (e: 'cancel'): void;
}>();

const schema = toTypedSchema(
  z.object({
    name: z.string().min(2, 'Min 2 characters').max(80),
    description: z.string().max(300).optional(),
  }),
);

const { handleSubmit } = useForm({
  validationSchema: schema,
  initialValues: {
    name: props.initial?.name ?? '',
    description: props.initial?.description ?? '',
  },
});

const onSubmit = handleSubmit((values) => {
  emits('submit', values);
});
</script>

<template>
  <form class="flex flex-col gap-6" @submit="onSubmit">
    <FormField v-slot="{ componentField }" name="name">
      <FormItem>
        <FormLabel>Name</FormLabel>
        <FormControl>
          <Input v-bind="componentField" placeholder="e.g. Product FAQ" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <FormField v-slot="{ componentField }" name="description">
      <FormItem>
        <FormLabel>Description</FormLabel>
        <FormControl>
          <Textarea v-bind="componentField" placeholder="Optional" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <div class="flex gap-2 justify-end">
      <Button type="button" variant="outline" @click="emits('cancel')">Cancel</Button>
      <Button type="submit" :disabled="submitting">{{ submitLabel }}</Button>
    </div>
  </form>
</template>
```

- [ ] **Step 2: Create `knowledgeCreate/Provider.vue`**

```vue
<script setup lang="ts">
import { IconArrowLeft } from '@tabler/icons-vue';

const store = useKnowledgeStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: { name: string; description?: string }) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    const created = await store.create(values);
    if (created) await navigateTo(`/knowledges/${created.id}/edit`);
    else await navigateTo('/knowledges');
  } catch (err: unknown) {
    const e = err as { message?: string };
    errorMessage.value = e?.message ?? 'Create failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/knowledges');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/knowledges" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to Knowledge
    </NuxtLink>
    <div>
      <h1 class="text-2xl font-semibold">New knowledge</h1>
      <p class="text-sm text-muted-foreground">Create a knowledge base. Sources and graph config come next.</p>
    </div>
    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>
    <KnowledgeForm
      :submitting="submitting"
      submit-label="Create"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
```

- [ ] **Step 3: Create `pages/knowledges/create.vue`**

```vue
<template>
  <KnowledgeCreateProvider />
</template>
```

- [ ] **Step 4: Verify in dev**

```bash
cd admin && npm run dev
```

Navigate to `http://localhost:3002/knowledges/create`, fill in name, submit. Expected: redirects to `/knowledges/<id>/edit` (404 for now — edit page comes next). Stop.

- [ ] **Step 5: Commit**

```bash
git add admin/slices/reins/components/knowledge/Form.vue admin/slices/reins/components/knowledgeCreate admin/slices/reins/pages/knowledges/create.vue
git commit -m "feat(admin-reins): knowledge create page"
```

---

## Phase 16 — Admin UI: Edit page (general tab)

### Task 16.1: Edit layout + general tab

**Files:**
- Create: `admin/slices/reins/components/knowledgeEdit/Provider.vue`
- Create: `admin/slices/reins/pages/knowledges/[id].vue`
- Create: `admin/slices/reins/pages/knowledges/[id]/edit.vue`

The `[id].vue` file is the wrapper that provides the tabs; child routes render inside `<NuxtPage />`.

- [ ] **Step 1: Create `pages/knowledges/[id].vue`**

```vue
<script setup lang="ts">
import { IconArrowLeft } from '@tabler/icons-vue';

const route = useRoute();
const router = useRouter();
const store = useKnowledgeStore();

const knowledgeId = computed(() => route.params.id as string);
const current = ref<Awaited<ReturnType<typeof store.fetchById>> | null>(null);

async function refresh() {
  current.value = await store.fetchById(knowledgeId.value);
}

onMounted(refresh);

let pollHandle: ReturnType<typeof setInterval> | null = null;

function startPollingIfIndexing() {
  if (pollHandle) return;
  pollHandle = setInterval(async () => {
    await refresh();
    if (current.value?.indexStatus !== 'indexing' && pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }, 3000);
}

watch(
  () => current.value?.indexStatus,
  (status) => {
    if (status === 'indexing') startPollingIfIndexing();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (pollHandle) clearInterval(pollHandle);
});

async function handleIndex() {
  if (!current.value) return;
  await store.startIndex(current.value.id);
  await refresh();
  startPollingIfIndexing();
}

const tabs = [
  { to: `/knowledges/${knowledgeId.value}/edit`, label: 'General' },
  { to: `/knowledges/${knowledgeId.value}/sources`, label: 'Sources' },
  { to: `/knowledges/${knowledgeId.value}/graph`, label: 'Graph' },
  { to: `/knowledges/${knowledgeId.value}/query`, label: 'Query' },
];

const indexDisabled = computed(() => current.value?.indexStatus === 'indexing');

provide('knowledge-current', current);
provide('knowledge-refresh', refresh);
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/knowledges" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back
    </NuxtLink>

    <div v-if="current" class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold">{{ current.name }}</h1>
        <p class="text-sm text-muted-foreground">
          <IndexStatusBadge :status="current.indexStatus" />
          <span v-if="current.indexError" class="ml-2 text-destructive">{{ current.indexError }}</span>
        </p>
      </div>
      <Button :disabled="indexDisabled" @click="handleIndex">
        {{ indexDisabled ? 'Indexing…' : 'Index' }}
      </Button>
    </div>

    <nav class="flex gap-2 border-b">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        active-class="border-b-2 border-primary font-medium"
        class="px-3 py-2 text-sm"
      >
        {{ tab.label }}
      </NuxtLink>
    </nav>

    <NuxtPage />
  </div>
</template>
```

- [ ] **Step 2: Create `components/knowledgeEdit/Provider.vue`**

```vue
<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';

const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: { name: string; description?: string }) {
  if (!current?.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await store.update(current.value.id, values);
    if (refresh) await refresh();
  } catch (err: unknown) {
    const e = err as { message?: string };
    errorMessage.value = e?.message ?? 'Update failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="current" class="max-w-xl">
    <p v-if="errorMessage" class="text-xs text-destructive mb-2">{{ errorMessage }}</p>
    <KnowledgeForm
      :initial="{ name: current.name, description: current.description }"
      :submitting="submitting"
      submit-label="Save"
      @submit="onSubmit"
      @cancel="$router.push('/knowledges')"
    />
  </div>
</template>
```

- [ ] **Step 3: Create `pages/knowledges/[id]/edit.vue`**

```vue
<template>
  <KnowledgeEditProvider />
</template>
```

- [ ] **Step 4: Verify**

```bash
cd admin && npm run dev
```

Navigate to `http://localhost:3002/knowledges/<id>/edit`. Expected: tabs render, General tab shows the name/description form, Index button works (starts async indexing, badge flips to Indexing…).

- [ ] **Step 5: Commit**

```bash
git add admin/slices/reins/components/knowledgeEdit admin/slices/reins/pages/knowledges/\[id\].vue admin/slices/reins/pages/knowledges/\[id\]/edit.vue
git commit -m "feat(admin-reins): knowledge edit layout with tabs + index button + polling"
```

---

## Phase 17 — Admin UI: Sources tab

### Task 17.1: Sources tab

**Files:**
- Create: `admin/slices/reins/components/knowledgeSources/Provider.vue`
- Create: `admin/slices/reins/components/knowledgeSources/AddDialog.vue`
- Create: `admin/slices/reins/pages/knowledges/[id]/sources.vue`

- [ ] **Step 1: Create `AddDialog.vue`**

```vue
<script setup lang="ts">
import type { SourceType } from '#reins/stores/knowledge';

const props = defineProps<{ knowledgeId: string }>();
const emits = defineEmits<{ (e: 'added'): void }>();

const store = useKnowledgeStore();
const open = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const type = ref<SourceType>('text');
const name = ref('');
const content = ref('');
const url = ref('');
const file = ref<File | null>(null);

function reset() {
  type.value = 'text';
  name.value = '';
  content.value = '';
  url.value = '';
  file.value = null;
  errorMessage.value = null;
}

async function submit() {
  submitting.value = true;
  errorMessage.value = null;
  try {
    if (type.value === 'text') {
      await store.addTextSource(props.knowledgeId, name.value, content.value);
    } else if (type.value === 'url') {
      await store.addUrlSource(props.knowledgeId, name.value, url.value);
    } else if (type.value === 'file') {
      if (!file.value) throw new Error('Pick a file');
      await store.addFileSource(props.knowledgeId, file.value);
    }
    emits('added');
    open.value = false;
    reset();
  } catch (err: unknown) {
    const e = err as { message?: string };
    errorMessage.value = e?.message ?? 'Failed';
  } finally {
    submitting.value = false;
  }
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  file.value = target.files?.[0] ?? null;
  if (file.value && !name.value) name.value = file.value.name;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button>Add source</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add source</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <div>
          <Label>Type</Label>
          <Select v-model="type">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="url">URL</SelectItem>
              <SelectItem value="file">File</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-if="type !== 'file'">
          <Label>Name</Label>
          <Input v-model="name" />
        </div>

        <div v-if="type === 'text'">
          <Label>Content</Label>
          <Textarea v-model="content" rows="8" />
        </div>

        <div v-if="type === 'url'">
          <Label>URL</Label>
          <Input v-model="url" placeholder="https://example.com/doc" />
        </div>

        <div v-if="type === 'file'">
          <Label>File</Label>
          <input type="file" @change="onFileChange" />
        </div>

        <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" @click="open = false">Cancel</Button>
        <Button :disabled="submitting" @click="submit">
          {{ submitting ? 'Saving…' : 'Add' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 2: Create `knowledgeSources/Provider.vue`**

```vue
<script setup lang="ts">
import type { IKnowledge, IReinsSource } from '#reins/stores/knowledge';
import { IconTrash } from '@tabler/icons-vue';

const route = useRoute();
const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const sources = ref<IReinsSource[]>([]);
const loading = ref(false);

async function reload() {
  loading.value = true;
  try {
    sources.value = await store.listSources(route.params.id as string);
  } finally {
    loading.value = false;
  }
}

onMounted(reload);

async function handleDelete(sourceId: string) {
  await store.removeSource(route.params.id as string, sourceId);
  await reload();
  if (refresh) await refresh();
}

function onAdded() {
  reload();
  if (refresh) refresh();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex justify-end">
      <KnowledgeSourcesAddDialog :knowledge-id="(route.params.id as string)" @added="onAdded" />
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>
    <div v-else-if="sources.length === 0" class="text-sm text-muted-foreground">
      No sources yet.
    </div>

    <div v-else class="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Indexed</TableHead>
            <TableHead class="text-right"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in sources" :key="s.id">
            <TableCell>{{ s.name }}</TableCell>
            <TableCell>{{ s.type }}</TableCell>
            <TableCell>
              <Badge :variant="s.lightragDocId ? 'default' : 'outline'">
                {{ s.lightragDocId ? 'Indexed' : 'Pending' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Confirm @confirm="handleDelete(s.id)">
                <Button size="sm" variant="ghost">
                  <IconTrash class="size-4" />
                </Button>
              </Confirm>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create `pages/knowledges/[id]/sources.vue`**

```vue
<template>
  <KnowledgeSourcesProvider />
</template>
```

- [ ] **Step 4: Verify**

```bash
cd admin && npm run dev
```

Open `/knowledges/<id>/sources`, add a text source, click Index in header, watch badges flip to Indexed.

- [ ] **Step 5: Commit**

```bash
git add admin/slices/reins/components/knowledgeSources admin/slices/reins/pages/knowledges/\[id\]/sources.vue
git commit -m "feat(admin-reins): sources tab with add/delete + indexed badge"
```

---

## Phase 18 — Admin UI: Graph tab

### Task 18.1: Graph tab (entity/relationship types config)

**Files:**
- Create: `admin/slices/reins/components/knowledgeGraph/Provider.vue`
- Create: `admin/slices/reins/pages/knowledges/[id]/graph.vue`

- [ ] **Step 1: Create `knowledgeGraph/Provider.vue`**

```vue
<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';

const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const entityTypes = ref<string[]>([]);
const relationshipTypes = ref<string[]>([]);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

watch(
  () => current?.value,
  (k) => {
    entityTypes.value = [...(k?.entityTypes ?? [])];
    relationshipTypes.value = [...(k?.relationshipTypes ?? [])];
  },
  { immediate: true },
);

async function save() {
  if (!current?.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await store.update(current.value.id, {
      entityTypes: entityTypes.value,
      relationshipTypes: relationshipTypes.value,
    });
    if (refresh) await refresh();
  } catch (err: unknown) {
    const e = err as { message?: string };
    errorMessage.value = e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="max-w-xl flex flex-col gap-6">
    <p class="text-sm text-muted-foreground">
      Entity and relationship types guide LightRAG's graph extraction. Examples: <code>person</code>, <code>product</code>, <code>concept</code>.
    </p>

    <div>
      <Label>Entity types</Label>
      <TagsInput v-model="entityTypes">
        <TagsInputItem v-for="item in entityTypes" :key="item" :value="item">
          <TagsInputItemText />
          <TagsInputItemDelete />
        </TagsInputItem>
        <TagsInputInput placeholder="Add entity type…" />
      </TagsInput>
    </div>

    <div>
      <Label>Relationship types</Label>
      <TagsInput v-model="relationshipTypes">
        <TagsInputItem v-for="item in relationshipTypes" :key="item" :value="item">
          <TagsInputItemText />
          <TagsInputItemDelete />
        </TagsInputItem>
        <TagsInputInput placeholder="Add relationship type…" />
      </TagsInput>
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <div class="flex justify-end">
      <Button :disabled="submitting" @click="save">
        {{ submitting ? 'Saving…' : 'Save' }}
      </Button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `pages/knowledges/[id]/graph.vue`**

```vue
<template>
  <KnowledgeGraphProvider />
</template>
```

- [ ] **Step 3: Verify**

```bash
cd admin && npm run dev
```

Open `/knowledges/<id>/graph`, add tags, save, reload — values persist.

- [ ] **Step 4: Commit**

```bash
git add admin/slices/reins/components/knowledgeGraph admin/slices/reins/pages/knowledges/\[id\]/graph.vue
git commit -m "feat(admin-reins): graph tab for entity/relationship type config"
```

---

## Phase 19 — Admin UI: Query tab

### Task 19.1: Query tab

**Files:**
- Create: `admin/slices/reins/components/knowledgeQuery/Provider.vue`
- Create: `admin/slices/reins/pages/knowledges/[id]/query.vue`

- [ ] **Step 1: Create `knowledgeQuery/Provider.vue`**

```vue
<script setup lang="ts">
import type { IQueryRecord } from '#reins/stores/knowledge';

const route = useRoute();
const store = useKnowledgeStore();

const query = ref('');
const mode = ref<'hybrid' | 'local' | 'global' | 'naive'>('hybrid');
const topK = ref(10);
const loading = ref(false);
const items = ref<IQueryRecord[]>([]);
const errorMessage = ref<string | null>(null);

async function run() {
  if (!query.value.trim()) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    items.value = await store.query(
      route.params.id as string,
      query.value,
      mode.value,
      topK.value,
    );
  } catch (err: unknown) {
    const e = err as { message?: string };
    errorMessage.value = e?.message ?? 'Query failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 md:grid-cols-[1fr_280px]">
    <div class="flex flex-col gap-4">
      <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>
      <div v-else-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</div>
      <div v-else-if="items.length === 0" class="text-sm text-muted-foreground">
        Enter a query and press Run.
      </div>
      <div v-for="(item, idx) in items" :key="idx" class="border rounded-md p-3">
        <div class="font-medium text-sm mb-1">{{ item.metadata.title ?? item.metadata.sourceId ?? 'Unknown source' }}</div>
        <p class="text-sm whitespace-pre-wrap">{{ item.pageContent }}</p>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <div>
        <Label>Query</Label>
        <Textarea v-model="query" rows="4" placeholder="Ask a question…" />
      </div>
      <div>
        <Label>Mode</Label>
        <Select v-model="mode">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hybrid">Hybrid</SelectItem>
            <SelectItem value="local">Local</SelectItem>
            <SelectItem value="global">Global</SelectItem>
            <SelectItem value="naive">Naive</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Top K</Label>
        <Input v-model.number="topK" type="number" min="1" max="100" />
      </div>
      <Button :disabled="loading" @click="run">Run</Button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `pages/knowledges/[id]/query.vue`**

```vue
<template>
  <KnowledgeQueryProvider />
</template>
```

- [ ] **Step 3: Verify end-to-end**

```bash
cd admin && npm run dev
```

Open `/knowledges/<id>/query`, run a query like "What is the sun?" for the smoke-test knowledge. Expected: result cards appear within 2-5 seconds.

- [ ] **Step 4: Commit**

```bash
git add admin/slices/reins/components/knowledgeQuery admin/slices/reins/pages/knowledges/\[id\]/query.vue
git commit -m "feat(admin-reins): query tab with mode/topK controls"
```

---

## Phase 20 — Kubernetes manifests

> Note: if you don't have a Hetzner cluster to test against, this phase produces yaml that will be validated by ArgoCD when the cluster is deployed. No local `kubectl apply` is required for the commit.

### Task 20.1: LightRAG Postgres (CNPG Cluster)

**Files:**
- Create: `k8s/platform/lightrag/postgres.yaml`

- [ ] **Step 1: Write CNPG cluster**

Create `k8s/platform/lightrag/postgres.yaml`:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: lightrag-postgres
  namespace: platform
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:16

  postgresql:
    parameters:
      shared_preload_libraries: "age"

  bootstrap:
    initdb:
      database: lightrag
      owner: lightrag
      postInitApplicationSQL:
        - CREATE EXTENSION IF NOT EXISTS vector;
        - CREATE EXTENSION IF NOT EXISTS age;
        - LOAD 'age';
        - SET search_path = ag_catalog, "$user", public;
      secret:
        name: lightrag-postgres-credentials

  storage:
    size: 20Gi
```

- [ ] **Step 2: Commit**

```bash
git add k8s/platform/lightrag/postgres.yaml
git commit -m "feat(k8s): add CNPG cluster for LightRAG with pgvector + AGE"
```

### Task 20.2: LightRAG Deployment + Service

**Files:**
- Create: `k8s/platform/lightrag/deployment.yaml`
- Create: `k8s/platform/lightrag/service.yaml`

- [ ] **Step 1: Write Deployment**

Create `k8s/platform/lightrag/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lightrag
  namespace: platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lightrag
  template:
    metadata:
      labels:
        app: lightrag
    spec:
      containers:
        - name: lightrag
          image: ghcr.io/hkuds/lightrag:latest
          ports:
            - containerPort: 9621
          env:
            - name: LIGHTRAG_API_KEY
              valueFrom:
                secretKeyRef:
                  name: lightrag-api
                  key: apiKey
            - name: LLM_BINDING
              value: openai
            - name: LLM_MODEL
              value: gpt-4o-mini
            - name: LLM_BINDING_API_KEY
              valueFrom:
                secretKeyRef:
                  name: lightrag-api
                  key: openaiApiKey
            - name: EMBEDDING_BINDING
              value: openai
            - name: EMBEDDING_MODEL
              value: text-embedding-3-small
            - name: EMBEDDING_BINDING_API_KEY
              valueFrom:
                secretKeyRef:
                  name: lightrag-api
                  key: openaiApiKey
            - name: POSTGRES_HOST
              value: lightrag-postgres-rw
            - name: POSTGRES_PORT
              value: "5432"
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: lightrag-postgres-credentials
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: lightrag-postgres-credentials
                  key: password
            - name: POSTGRES_DATABASE
              value: lightrag
            - name: LIGHTRAG_KV_STORAGE
              value: PGKVStorage
            - name: LIGHTRAG_DOC_STATUS_STORAGE
              value: PGDocStatusStorage
            - name: LIGHTRAG_VECTOR_STORAGE
              value: PGVectorStorage
            - name: LIGHTRAG_GRAPH_STORAGE
              value: PGGraphStorage
          readinessProbe:
            httpGet:
              path: /health
              port: 9621
              httpHeaders:
                - name: x-api-key
                  value: probe-only
            initialDelaySeconds: 20
            periodSeconds: 10
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
```

- [ ] **Step 2: Write Service**

Create `k8s/platform/lightrag/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: lightrag
  namespace: platform
spec:
  type: ClusterIP
  selector:
    app: lightrag
  ports:
    - port: 9621
      targetPort: 9621
      protocol: TCP
      name: http
```

- [ ] **Step 3: Commit**

```bash
git add k8s/platform/lightrag/deployment.yaml k8s/platform/lightrag/service.yaml
git commit -m "feat(k8s): add LightRAG Deployment + Service"
```

### Task 20.3: Secret scaffolding

**Files:**
- Create: `k8s/platform/lightrag/secret.yaml` (scaffold with placeholders)

- [ ] **Step 1: Write secret placeholder**

Create `k8s/platform/lightrag/secret.yaml`:

```yaml
# This secret must be provisioned out-of-band via `make k8s-secrets`.
# The file below is committed as a reference only — apiKey and openaiApiKey
# are filled in at deploy time.
apiVersion: v1
kind: Secret
metadata:
  name: lightrag-api
  namespace: platform
type: Opaque
stringData:
  apiKey: CHANGE_ME
  openaiApiKey: CHANGE_ME
```

- [ ] **Step 2: Commit**

```bash
git add k8s/platform/lightrag/secret.yaml
git commit -m "feat(k8s): add LightRAG secret scaffold"
```

### Task 20.4: Register with ArgoCD app-of-apps

**Files:**
- Modify: `k8s/argocd/app-of-apps.yaml`

- [ ] **Step 1: Read current app-of-apps to understand format**

```bash
cat k8s/argocd/app-of-apps.yaml
```

- [ ] **Step 2: Add lightrag entry**

Add a new Application block for lightrag following the same pattern used by `api`, `app`, `admin`. Key fields: `name: lightrag`, `path: k8s/platform/lightrag`, destination namespace `platform`, same sync policy as siblings.

Exact edit will depend on the existing list format. If unsure, copy the `api` Application block verbatim and change `name`, `path`, and remove any image-specific fields (none for lightrag).

- [ ] **Step 3: Commit**

```bash
git add k8s/argocd/app-of-apps.yaml
git commit -m "feat(k8s): register lightrag in ArgoCD app-of-apps"
```

### Task 20.5: Extend `make k8s-secrets` for lightrag

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Locate `k8s-secrets` target**

```bash
grep -n "k8s-secrets" Makefile
```

- [ ] **Step 2: Add LightRAG secret provisioning**

In the same target block, append two `kubectl create secret` steps after the existing ones (adapt to the existing template):

```makefile
	@read -s -p "LightRAG API key: " LIGHTRAG_API_KEY; echo; \
	  read -s -p "OpenAI API key: " OPENAI_API_KEY; echo; \
	  kubectl -n platform create secret generic lightrag-api \
	    --from-literal=apiKey="$$LIGHTRAG_API_KEY" \
	    --from-literal=openaiApiKey="$$OPENAI_API_KEY" \
	    --dry-run=client -o yaml | kubectl apply -f -
```

Prefix is `\t` (tab, not spaces) — Makefiles require tabs.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "chore(k8s): add lightrag secret provisioning to make k8s-secrets"
```

---

## Phase 21 — Final verification and polish

### Task 21.1: Full backend test suite

**Files:** none

- [ ] **Step 1: Run all tests**

```bash
cd api && npm test
```

Expected: all reins tests pass (8 client tests + 6 service tests = 14 specs). Other slices show `passWithNoTests`.

- [ ] **Step 2: Run linter**

```bash
cd api && npm run lint
cd ../admin && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Build api**

```bash
cd api && npm run build
```

Expected: clean build.

### Task 21.2: Manual end-to-end in admin UI

- [ ] **Step 1: Spin everything up**

```bash
cd /Users/hatsaxi/Work/ranch
make dev
```

Wait for api and admin to be ready.

- [ ] **Step 2: Walk the happy path**

1. Open `http://localhost:3002/knowledges`.
2. Click "New knowledge", name it, create.
3. On the edit page, click Sources tab, add a text source ("content: paris is capital of france").
4. Hit Index. Badge goes Indexing → Ready within ~30s.
5. Click Query tab, ask "What is the capital of France?". Expect a card mentioning Paris.
6. Delete the knowledge from the list. Confirm it disappears.

If anything fails, gather logs:
```bash
make lightrag-logs
docker compose -f api/docker-compose.yml logs postgres-local --tail=50
```

- [ ] **Step 3: Final commit (optional cleanup)**

If any TODOs or small fixes were needed during verification, commit them now with a `fix(reins): ...` message.

---

## Out of Scope (deferred)

These items from the design spec are explicitly not implemented in this plan and should be tracked as follow-ups:

- `app/slices/reins/` (user-facing query UI)
- Knowledge graph visualization
- Team / user scoping (blocked on Ranch team model)
- BullMQ / dedicated queue for indexing
- LightRAG horizontal scaling
- LLM providers other than OpenAI
- Cohere rerank
- Embedded LightRAG WebUI in admin
- Reading LLM keys from `LlmCredential` table
- Soft-delete + cleanup job

---

## Self-Review Notes

**Spec coverage:**
- [x] Prisma model for Knowledge + ReinsSource — Phase 1
- [x] Domain types + abstract gateway + service — Phases 2, 6
- [x] LightRAG HTTP client with tests — Phase 3
- [x] Data gateway + mapper — Phase 4
- [x] DTOs — Phase 5
- [x] MinIO integration — Phase 7
- [x] Controller — Phase 8
- [x] Module wiring — Phase 9
- [x] Local infra (docker-compose, env, Makefile) — Phase 10
- [x] Admin UI slice scaffold — Phase 11
- [x] SDK regeneration — Phase 12
- [x] Pinia store — Phase 13
- [x] List / Create / Edit / Sources / Graph / Query — Phases 14–19
- [x] K8s manifests + ArgoCD — Phase 20

**Type consistency:**
- `IKnowledgeData`, `IReinsSourceData`, `IndexStatusTypes`, `SourceTypes`, `QueryModeTypes` used consistently in api.
- `ReinsService` signatures match controller invocations.
- Admin store types (`IKnowledge`, `IReinsSource`) mirror API DTOs with string dates (ISO).

**Placeholder check:** None remain in the plan. One intentional fallback note in Phase 13 Step 1 about verifying generated SDK method names — that's a reality of hey-api generator quirks, not a plan gap.
