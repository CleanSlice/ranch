import { SourceGateway } from './source.gateway';
import { SourceMapper } from './source.mapper';
import { ISourceData } from '../domain/source.types';
import {
  ITrackStatus,
  IDocumentRecord,
  LightragTimeoutError,
} from '../../lightrag/domain/lightrag.types';
import { indexBudgetMs } from '../domain/indexBudget';

const POLL_MS = 3000;
// The wait now scales with the batch's content volume, so derive it rather
// than hardcoding. These fixtures are text sources with no known size, which
// leaves just the base plus the per-document term.
const TIMEOUT_MS = indexBudgetMs([{ sizeBytes: null }]);

function makeSource(overrides: Partial<ISourceData> = {}): ISourceData {
  return {
    id: 'src-1',
    knowledgeId: 'knowledge-1',
    type: 'text',
    name: 'notes.txt',
    url: null,
    mimeType: null,
    content: 'Mazda CX-5 has a naturally aspirated engine.',
    sizeBytes: null,
    indexed: false,
    indexStatus: 'pending',
    indexState: 'queued',
    indexError: null,
    indexedAt: null,
    indexAttempts: 0,
    indexRetryAt: null,
    textState: 'none',
    textUrl: null,
    textError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function processed(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processed', errorMessage: null, updatedAt: null }],
  };
}

function stillProcessing(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processing', errorMessage: null, updatedAt: null }],
  };
}

function failed(message: string): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'failed', errorMessage: message, updatedAt: null }],
  };
}

interface IRowPatch {
  lightragDocId?: string | null;
  indexState?: string;
  indexError?: string | null;
  indexedAt?: Date | null;
  indexAttempts?: number | { increment: number };
  indexRetryAt?: Date | null;
  indexRequeuedOverAt?: Date | null;
}

// Tracks the columns the gateway writes, applying only the keys each update
// actually sends - the way Prisma does - so a `{ indexError }` write cannot
// be mistaken for clearing the doc id.
function makePrismaStub(docIds: Record<string, string | null> = {}) {
  const states: Record<string, string> = {};
  const errors: Record<string, string | null> = {};
  const indexedAt: Record<string, Date | null> = {};
  const attempts: Record<string, number> = {};
  const retryAt: Record<string, Date | null> = {};
  const requeuedOver: Record<string, Date | null> = {};
  const row = (id: string) => ({
    id,
    knowledgeId: 'knowledge-1',
    lightragDocId: docIds[id] ?? null,
    indexError: errors[id] ?? null,
    indexedAt: indexedAt[id] ?? null,
    indexAttempts: attempts[id] ?? 0,
    indexRetryAt: retryAt[id] ?? null,
    indexRequeuedOverAt: requeuedOver[id] ?? null,
  });
  return {
    docIds,
    states,
    errors,
    indexedAt,
    attempts,
    retryAt,
    requeuedOver,
    source: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(row(where.id)),
      ),
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map(row)),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: IRowPatch }) => {
          if ('lightragDocId' in data) docIds[where.id] = data.lightragDocId!;
          if ('indexState' in data) states[where.id] = data.indexState!;
          if ('indexError' in data) errors[where.id] = data.indexError!;
          if ('indexedAt' in data) indexedAt[where.id] = data.indexedAt!;
          if (typeof data.indexAttempts === 'number') {
            attempts[where.id] = data.indexAttempts;
          } else if (data.indexAttempts !== undefined) {
            attempts[where.id] =
              (attempts[where.id] ?? 0) + data.indexAttempts.increment;
          }
          if ('indexRetryAt' in data) retryAt[where.id] = data.indexRetryAt!;
          if ('indexRequeuedOverAt' in data) {
            requeuedOver[where.id] = data.indexRequeuedOverAt!;
          }
          return Promise.resolve(row(where.id));
        },
      ),
    },
  };
}

function inFlight(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processing', errorMessage: null, updatedAt: null }],
  };
}

function duplicateOf(docId: string, originalStatus: string): ITrackStatus {
  return {
    documents: [
      {
        id: 'dup-1',
        status: 'failed',
        errorMessage: `Identical content already exists under another filename. Original doc_id: ${docId}, Status: ${originalStatus}`,
        updatedAt: null,
      },
    ],
  };
}

function makeLightragStub(
  statuses: ITrackStatus[],
  documents: IDocumentRecord[] = [],
) {
  const queue = [...statuses];
  return {
    ingestText: jest.fn(() => Promise.resolve({ docId: 'track-1' })),
    ingestUrl: jest.fn(() => Promise.resolve({ docId: 'track-1' })),
    ingestFile: jest.fn(() => Promise.resolve({ docId: 'track-1' })),
    getTrackStatus: jest.fn(() =>
      Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]),
    ),
    listDocuments: jest.fn(() => Promise.resolve(documents)),
    health: jest.fn(() => Promise.resolve({ ok: true, configuration: null })),
  };
}

type Prisma = ConstructorParameters<typeof SourceGateway>[0];
type Lightrag = ConstructorParameters<typeof SourceGateway>[2];
type S3 = ConstructorParameters<typeof SourceGateway>[3];
type KnowledgeConfig = ConstructorParameters<typeof SourceGateway>[4];

function makeS3Stub(objects: Record<string, string> = {}) {
  return {
    download: jest.fn((location: { key: string }) =>
      Promise.resolve(Buffer.from(objects[location.key] ?? '', 'utf8')),
    ),
  };
}

function makeGateway(
  prisma: ReturnType<typeof makePrismaStub>,
  lightrag: ReturnType<typeof makeLightragStub>,
  s3: ReturnType<typeof makeS3Stub> = makeS3Stub(),
): SourceGateway {
  // The gateway's constructor takes the full Prisma client and the S3/config
  // deps, but indexSources only touches `source` and the LightRAG client, so
  // structural stubs are enough. Same idiom as browser.gateway.spec.ts.
  return new SourceGateway(
    prisma as unknown as Prisma,
    new SourceMapper(),
    lightrag as unknown as Lightrag,
    s3 as unknown as S3,
    {} as unknown as KnowledgeConfig,
  );
}

describe('SourceGateway.indexSources', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists the doc id only once LightRAG reports the document processed', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([stillProcessing(), processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    expect(outcomes).toEqual([
      {
        sourceId: 'src-1',
        name: 'notes.txt',
        status: 'indexed',
        indexed: true,
        error: null,
        retryAt: null,
      },
    ]);
    expect(prisma.docIds['src-1']).toBe('track-1');
    // The row itself remembers when it became searchable and drops any error.
    expect(prisma.indexedAt['src-1']).toBeInstanceOf(Date);
    expect(prisma.errors['src-1']).toBeNull();
  });

  it('records the failure on the row so the sources table can show it', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([failed('embedding request rejected')]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    await run;

    expect(prisma.errors['src-1']).toBe('embedding request rejected');
    // The resume handle from ingest stays put; it is what lets the next run
    // ask LightRAG about this document instead of uploading it again.
    expect(prisma.docIds['src-1']).toBe('track-1');
    // Nothing was confirmed, so the row is not searchable.
    expect(prisma.indexedAt['src-1']).toBeUndefined();
  });

  it('clears a leftover error once LightRAG confirms the document processed', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    await gateway.indexSources([
      makeSource({
        indexed: true,
        indexStatus: 'indexed',
        indexError: 'transient failure from an earlier run',
      }),
    ]);

    // Otherwise a source that eventually converged stays red in the UI.
    expect(prisma.errors['src-1']).toBeNull();
    expect(prisma.docIds['src-1']).toBe('track-existing');
  });

  it('stamps a source the previous run stopped waiting for', async () => {
    // The state a timed-out run leaves behind: a handle, no `indexedAt`, no
    // error. Observed on a 1 MB manual that LightRAG finished 50 minutes after
    // the run gave up - every later run recognised it as processed and wrote
    // nothing, so the base sat at 2 of 3 forever.
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: false, indexStatus: 'pending', indexedAt: null }),
    ]);

    expect(outcomes[0].indexed).toBe(true);
    expect(prisma.indexedAt['src-1']).toBeInstanceOf(Date);
    expect(prisma.docIds['src-1']).toBe('track-existing');
    // Confirming must not mean re-uploading: the copy is already in there.
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(lightrag.ingestFile).not.toHaveBeenCalled();
  });

  it('does not rewrite a row that is already stamped and clean', async () => {
    // One pointless update per source per run is a few hundred writes on a
    // real base, and it would also move `indexedAt` for content that has not
    // been touched since.
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    await gateway.indexSources([
      makeSource({
        indexed: true,
        indexStatus: 'indexed',
        indexedAt: new Date(1000),
        textState: 'none',
        textUrl: null,
        textError: null,
        indexError: null,
      }),
    ]);

    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it('leaves the source unindexed and surfaces the reason when processing fails', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([failed('embedding request rejected')]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes).toEqual([
      {
        sourceId: 'src-1',
        name: 'notes.txt',
        status: 'failed',
        indexed: false,
        error: 'embedding request rejected',
        retryAt: null,
      },
    ]);
    // No confirmation timestamp, so `indexed` stays false and the next run
    // retries after checking what LightRAG did with the handle.
    expect(prisma.indexedAt['src-1']).toBeUndefined();
  });

  it('re-ingests a source that claims to be indexed when LightRAG has nothing for it', async () => {
    const prisma = makePrismaStub({ 'src-1': 'stale-track' });
    const lightrag = makeLightragStub([{ documents: [] }, processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource({ indexed: true })]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    expect(lightrag.ingestText).toHaveBeenCalledTimes(1);
    expect(outcomes[0].indexed).toBe(true);
    expect(prisma.docIds['src-1']).toBe('track-1');
  });

  it('does not re-ingest a source LightRAG still reports as processed', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: true }),
    ]);

    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      {
        sourceId: 'src-1',
        name: 'notes.txt',
        status: 'indexed',
        indexed: true,
        error: null,
        retryAt: null,
      },
    ]);
    expect(prisma.docIds['src-1']).toBe('track-existing');
  });

  it('sends the extracted text, not the file, for a scanned PDF that is ready', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([processed()]);
    const s3 = makeS3Stub({ 'k/scan.pdf.ocr.txt': '--- page 1 ---\nOrder form' });
    const gateway = makeGateway(prisma, lightrag, s3);

    const run = gateway.indexSources([
      makeSource({
        type: 'file',
        url: 's3://b/k/scan.pdf',
        mimeType: 'application/pdf',
        textState: 'ready',
        textUrl: 's3://b/k/scan.pdf.ocr.txt',
      }),
    ]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    expect(lightrag.ingestFile).not.toHaveBeenCalled();
    expect(lightrag.ingestText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '--- page 1 ---\nOrder form',
        fileSource: 'src-1',
      }),
    );
    expect(outcomes[0].status).toBe('indexed');
  });

  it('waits for a PDF whose text is still being extracted instead of uploading it', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({
        type: 'file',
        url: 's3://b/k/scan.pdf',
        mimeType: 'application/pdf',
        textState: 'pending',
      }),
    ]);

    expect(lightrag.ingestFile).not.toHaveBeenCalled();
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes[0]).toEqual(
      expect.objectContaining({ status: 'pending', indexed: false }),
    );
    expect(outcomes[0].error).toContain('text extraction in progress');
  });

  it('reports the extraction reason for a PDF whose OCR failed and never uploads it', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({
        type: 'file',
        url: 's3://b/k/scan.pdf',
        mimeType: 'application/pdf',
        textState: 'failed',
        textError: 'OCR is disabled in Settings > Knowledge',
      }),
    ]);

    expect(lightrag.ingestFile).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].error).toContain('OCR is disabled');
  });

  it('answers from the document snapshot instead of asking LightRAG per source', async () => {
    // One listDocuments call per run already says which doc ids are
    // processed. Before this, every confirmed source still cost a
    // getTrackStatus round-trip: 651 of them on the Mazda base, against a
    // service busy indexing, before the run had anything to wait on.
    const prisma = makePrismaStub({ 'src-1': 'doc-existing' });
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-existing', status: 'processed', filePath: 'notes.txt', errorMessage: null, updatedAt: null }],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: true }),
    ]);

    expect(lightrag.getTrackStatus).not.toHaveBeenCalled();
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe('indexed');
  });

  it('still asks LightRAG about a handle the snapshot does not know', async () => {
    // A track id from a recent ingest is not a doc id, so the snapshot cannot
    // vouch for it; that is the one case the per-source call is for.
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-other', status: 'processed', filePath: 'other.txt', errorMessage: null, updatedAt: null }],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: true }),
    ]);

    expect(lightrag.getTrackStatus).toHaveBeenCalledTimes(1);
    expect(outcomes[0].status).toBe('indexed');
  });

  it('waits for a document still in the pipeline instead of re-uploading it', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    const lightrag = makeLightragStub([inFlight(), processed()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource({ indexed: true })]);
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    const outcomes = await run;

    // Re-uploading here is what made LightRAG answer 409 "Document storage
    // already contains ..." when an index run overlapped a reprocess.
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes[0].indexed).toBe(true);
  });

  it('adopts the original document when the upload is refused as a duplicate', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([
      duplicateOf('doc-c8d0423fb8bc5700de256d6cb7fe89c8', 'processed'),
    ]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes[0]).toEqual({
      sourceId: 'src-1',
      name: 'notes.txt',
      status: 'indexed',
      indexed: true,
      error: null,
      retryAt: null,
    });
    expect(prisma.docIds['src-1']).toBe('doc-c8d0423fb8bc5700de256d6cb7fe89c8');
  });

  it('does not adopt an original document that failed itself', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([
      duplicateOf('doc-c8d0423fb8bc5700de256d6cb7fe89c8', 'failed'),
    ]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].error).toContain('Identical content already exists');
    expect(prisma.indexedAt['src-1']).toBeUndefined();
  });

  it('resolves an adopted doc id through the document snapshot', async () => {
    const prisma = makePrismaStub({
      'src-1': 'doc-c8d0423fb8bc5700de256d6cb7fe89c8',
    });
    // An adopted doc id is not a track id, so track_status knows nothing about
    // it. Without the snapshot fallback the source would be re-ingested and
    // refused as a duplicate again, forever.
    const lightrag = makeLightragStub(
      [{ documents: [] }],
      [
        {
          id: 'doc-c8d0423fb8bc5700de256d6cb7fe89c8',
          status: 'processed',
          filePath: 'notes.txt',
          errorMessage: null,
          updatedAt: null,
        },
      ],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({ indexed: true }),
    ]);

    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(outcomes[0].indexed).toBe(true);
  });

  it('claims the stored document when the upload is refused by filename', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-stored', status: 'processed', filePath: 'notes.txt', errorMessage: null, updatedAt: null }],
    );
    // LightRAG names only the file in this refusal, never the doc id, so the
    // id has to come from the listing. Ranch reaches this state whenever it
    // lost the id for a document LightRAG still holds.
    lightrag.ingestText.mockRejectedValueOnce(
      new Error(
        `LightRAG /documents/upload failed: 409 {"detail":"Document storage already contains 'notes.txt' (Status: processed). Delete the existing record before re-uploading."}`,
      ),
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([makeSource()]);

    expect(outcomes[0]).toEqual({
      sourceId: 'src-1',
      name: 'notes.txt',
      status: 'indexed',
      indexed: true,
      error: null,
      retryAt: null,
    });
    expect(prisma.docIds['src-1']).toBe('doc-stored');
  });

  it('still fails when the stored document under that filename is not processed', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-stored', status: 'failed', filePath: 'notes.txt', errorMessage: null, updatedAt: null }],
    );
    lightrag.ingestText.mockRejectedValueOnce(
      new Error(
        `LightRAG /documents/upload failed: 409 {"detail":"Document storage already contains 'notes.txt' (Status: failed)."}`,
      ),
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([makeSource()]);

    // Claiming a failed document would hide a real problem behind a green
    // badge.
    expect(outcomes[0].indexed).toBe(false);
    expect(prisma.docIds['src-1']).toBeUndefined();
  });

  it('reports a document still in the pipeline as pending, not failed', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([stillProcessing()]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
    const outcomes = await run;

    // The run stopped waiting; LightRAG did not stop working. Calling this a
    // failure is what painted a healthy re-index of a large base red.
    expect(outcomes[0].status).toBe('pending');
    expect(outcomes[0].indexed).toBe(false);
    expect(outcomes[0].error).toContain('still processing');
    // The handle is kept so the next run resumes the wait rather than
    // uploading a second copy, and no error is left on the row.
    expect(prisma.docIds['src-1']).toBe('track-1');
    expect(prisma.errors['src-1']).toBeNull();
    expect(prisma.indexedAt['src-1']).toBeUndefined();
  });

  it('waits for a stored document the refusal reports as still processing', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-stored', status: 'processing', filePath: 'notes.txt', errorMessage: null, updatedAt: null }],
    );
    // Same 409 as the adopt-by-filename case, but the stored copy has not
    // finished yet. Reporting a failure here made every overlapping run red
    // even though the document was minutes away from being searchable.
    lightrag.ingestText.mockRejectedValueOnce(
      new Error(
        `LightRAG /documents/upload failed: 409 {"detail":"Document storage already contains 'notes.txt' (Status: processing)."}`,
      ),
    );
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(outcomes[0].status).toBe('indexed');
    expect(prisma.docIds['src-1']).toBe('doc-stored');
  });
});

describe('SourceGateway: what a failure earns', () => {
  const NOW = new Date('2026-09-17T00:20:00Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules a retry after a failure that will pass on its own', async () => {
    // The 2026-09-17 outage: Bedrock 503 for a quarter of an hour, LightRAG's
    // own retry exhausted in seconds, nine good documents red until morning.
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([
      failed('RetryError[<Future at 0x7f state=finished raised BedrockConnectionError>]'),
    ]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    // Measured from when the failure was seen (after the first poll), not
    // from when the run started.
    const fiveMinutesOn = new Date(Date.now() + 5 * 60_000);
    expect(prisma.attempts['src-1']).toBe(1);
    expect(prisma.retryAt['src-1']).toEqual(fiveMinutesOn);
    expect(outcomes[0].retryAt).toEqual(fiveMinutesOn);
    // The handle stays: reprocessing the document LightRAG holds is the retry.
    expect(prisma.docIds['src-1']).toBe('track-1');
  });

  it('waits longer each time and gives up after the third retry', async () => {
    const prisma = makePrismaStub();
    prisma.attempts['src-1'] = 3;
    const lightrag = makeLightragStub([failed('RetryError[...]')]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    const outcomes = await run;

    expect(prisma.attempts['src-1']).toBe(4);
    expect(prisma.retryAt['src-1']).toBeNull();
    expect(outcomes[0].retryAt).toBeNull();
    expect(prisma.errors['src-1']).toBe('RetryError[...]');
  });

  it('never schedules a failure that is about the document', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([
      failed('File content contains only whitespace characters'),
    ]);
    const gateway = makeGateway(prisma, lightrag);

    const run = gateway.indexSources([makeSource()]);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    await run;

    expect(prisma.attempts['src-1']).toBe(1);
    expect(prisma.retryAt['src-1']).toBeNull();
  });

  it('forgets the failures once LightRAG confirms the document', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-existing' });
    prisma.attempts['src-1'] = 2;
    prisma.retryAt['src-1'] = NOW;
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    await gateway.indexSources([makeSource({ indexError: 'RetryError[...]' })]);

    expect(prisma.attempts['src-1']).toBe(0);
    expect(prisma.retryAt['src-1']).toBeNull();
  });

  it('records a failure the single-row path meets the same way', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-1' });
    const lightrag = makeLightragStub([failed('RetryError[...]')]);
    const gateway = makeGateway(prisma, lightrag);

    await gateway.waitForSourceIndexed('src-1');

    expect(prisma.states['src-1']).toBe('failed');
    expect(prisma.attempts['src-1']).toBe(1);
    expect(prisma.retryAt['src-1']).toEqual(new Date('2026-09-17T00:25:00Z'));
  });

  it('leaves a slow document in flight for the reconciler instead of failing it', async () => {
    // A 1 MB manual outlives the single-row wait routinely. Calling that a
    // failure hid a working document behind a red badge and, worse, let the
    // next click re-upload it into a duplicate refusal.
    const prisma = makePrismaStub({ 'src-1': 'track-1' });
    const lightrag = makeLightragStub([stillProcessing()]);
    const gateway = makeGateway(prisma, lightrag);

    const wait = gateway.waitForSourceIndexed('src-1');
    await jest.advanceTimersByTimeAsync(15 * 60_000 + POLL_MS);
    await wait;

    expect(prisma.states['src-1']).toBe('processing');
    expect(prisma.errors['src-1']).toBeNull();
    expect(prisma.docIds['src-1']).toBe('track-1');
    expect(prisma.attempts['src-1'] ?? 0).toBe(0);
  });
});

describe('SourceGateway.indexSource (one row, the Reindex button)', () => {
  it('does not upload a PDF whose text is still being extracted', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    await expect(
      gateway.indexSource(
        makeSource({
          type: 'file',
          url: 's3://b/k/scan.pdf',
          mimeType: 'application/pdf',
          textState: 'pending',
        }),
      ),
    ).rejects.toThrow('text extraction in progress');

    expect(lightrag.ingestFile).not.toHaveBeenCalled();
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    // Waiting is not a failure of the row.
    expect(prisma.errors['src-1'] ?? null).toBeNull();
  });

  it('records the extraction failure as the index error instead of uploading', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([processed()]);
    const gateway = makeGateway(prisma, lightrag);

    await expect(
      gateway.indexSource(
        makeSource({
          type: 'file',
          url: 's3://b/k/scan.pdf',
          mimeType: 'application/pdf',
          textState: 'failed',
          textError: 'OCR is disabled in Settings > Knowledge',
        }),
      ),
    ).rejects.toThrow('text extraction failed: OCR is disabled');

    expect(lightrag.ingestFile).not.toHaveBeenCalled();
    expect(prisma.errors['src-1']).toContain('OCR is disabled');
  });
});


describe('SourceGateway.confirmProcessed: a document LightRAG gave up on', () => {
  const VERDICT = new Date('2026-09-17T00:30:00Z');

  function heldFailed(
    id: string,
    errorMessage: string | null,
    updatedAt: Date | null = VERDICT,
  ): IDocumentRecord {
    return { id, status: 'failed', filePath: 'notes.txt', errorMessage, updatedAt };
  }

  it('records the failure and keeps the handle the retry will reprocess', async () => {
    // Before: the handle was dropped and nothing written, so the row sat at
    // `processing` with no way back - "Indexing…" for four days.
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const lightrag = makeLightragStub(
      [],
      [heldFailed('doc-1', 'RetryError[<Future raised BedrockConnectionError>]')],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.confirmProcessed([
      makeSource({ indexState: 'processing', updatedAt: new Date(0) }),
    ]);

    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].retryAt).toBeInstanceOf(Date);
    expect(prisma.states['src-1']).toBe('failed');
    expect(prisma.errors['src-1']).toContain('BedrockConnectionError');
    expect(prisma.attempts['src-1']).toBe(1);
    expect(prisma.docIds['src-1']).toBe('doc-1');
  });

  it('adopts the processed original a refusal names', async () => {
    const prisma = makePrismaStub({ 'src-1': 'dup-1' });
    const lightrag = makeLightragStub(
      [],
      [
        heldFailed(
          'dup-1',
          'Identical content already exists under another filename. Original doc_id: doc-9, Status: processed',
        ),
      ],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.confirmProcessed([
      makeSource({ indexState: 'processing', updatedAt: new Date(0) }),
    ]);

    expect(outcomes[0].indexed).toBe(true);
    expect(prisma.docIds['src-1']).toBe('doc-9');
    expect(prisma.indexedAt['src-1']).toBeInstanceOf(Date);
  });

  it('leaves alone a row re-queued over the very verdict it is looking at', async () => {
    // The retry put the row back in flight over LightRAG's 00:30 verdict and
    // the pipeline has simply not reached the document yet. Recording that
    // as a new failure would spend an attempt on nothing.
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    prisma.requeuedOver['src-1'] = VERDICT;
    const lightrag = makeLightragStub([], [heldFailed('doc-1', 'RetryError[...]')]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.confirmProcessed([
      makeSource({ indexState: 'processing' }),
    ]);

    expect(outcomes[0].status).toBe('pending');
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it('records a verdict newer than the one the row was re-queued over', async () => {
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    prisma.requeuedOver['src-1'] = VERDICT;
    const lightrag = makeLightragStub(
      [],
      [heldFailed('doc-1', 'RetryError[...]', new Date('2026-09-17T00:41:00Z'))],
    );
    const gateway = makeGateway(prisma, lightrag);

    await gateway.confirmProcessed([makeSource({ indexState: 'processing' })]);

    expect(prisma.states['src-1']).toBe('failed');
    expect(prisma.attempts['src-1']).toBe(1);
    expect(prisma.requeuedOver['src-1']).toBeNull();
  });

  it('treats a verdict with no timestamp as fresh', async () => {
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    prisma.requeuedOver['src-1'] = VERDICT;
    const lightrag = makeLightragStub([], [heldFailed('doc-1', 'RetryError[...]', null)]);
    const gateway = makeGateway(prisma, lightrag);

    await gateway.confirmProcessed([makeSource({ indexState: 'processing' })]);

    expect(prisma.states['src-1']).toBe('failed');
  });

  it('does not spend a second attempt on the failure it already recorded', async () => {
    // An index run and a reconcile pass can both meet the same verdict.
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    prisma.errors['src-1'] = 'RetryError[...]';
    prisma.attempts['src-1'] = 1;
    prisma.retryAt['src-1'] = new Date(Date.now() + 5 * 60_000);
    const lightrag = makeLightragStub([], [heldFailed('doc-1', 'RetryError[...]')]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.confirmProcessed([
      makeSource({ indexState: 'processing' }),
    ]);

    expect(outcomes[0].retryAt).toEqual(prisma.retryAt['src-1']);
    expect(prisma.attempts['src-1']).toBe(1);
  });

  it('spends exactly one attempt per verdict and stops after the third retry', async () => {
    // The whole loop, in one place: a fresh verdict costs an attempt, the
    // retry re-queues the row over it, the same verdict seen again costs
    // nothing, the next verdict costs the next attempt, and after the fourth
    // failure no slot is scheduled.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-17T00:00:00Z'));
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const doc = heldFailed('doc-1', 'RetryError[...]', new Date('2026-09-17T00:00:00Z'));
    const gateway = makeGateway(prisma, makeLightragStub([], [doc]));
    const row = () => makeSource({ indexState: 'processing' });
    const failedRow = () =>
      makeSource({
        indexState: 'failed',
        indexError: 'RetryError[...]',
        indexAttempts: prisma.attempts['src-1'],
        indexRetryAt: prisma.retryAt['src-1'],
      });

    try {
      for (let verdict = 1; verdict <= 4; verdict += 1) {
        doc.updatedAt = new Date(Date.now());
        await gateway.confirmProcessed([row()]);
        expect(prisma.attempts['src-1']).toBe(verdict);
        if (verdict < 4) {
          expect(prisma.retryAt['src-1']).toBeInstanceOf(Date);
          jest.setSystemTime(prisma.retryAt['src-1']!);
          await gateway.retryFailed([failedRow()]);
          expect(prisma.states['src-1']).toBe('processing');
          // The pipeline has not touched it yet: same verdict, no charge.
          const again = await gateway.confirmProcessed([row()]);
          expect(again[0].status).toBe('pending');
          expect(prisma.attempts['src-1']).toBe(verdict);
          jest.setSystemTime(Date.now() + 60_000);
        }
      }
      expect(prisma.retryAt['src-1']).toBeNull();
      expect(prisma.states['src-1']).toBe('failed');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SourceGateway.retryFailed', () => {
  function heldAs(
    id: string,
    status: IDocumentRecord['status'],
    updatedAt: Date | null = null,
  ): IDocumentRecord {
    return { id, status, filePath: 'notes.txt', errorMessage: null, updatedAt };
  }

  function failedRow(overrides: Partial<ISourceData> = {}): ISourceData {
    return makeSource({
      indexState: 'failed',
      indexStatus: 'retrying',
      indexError: 'RetryError[...]',
      indexAttempts: 1,
      indexRetryAt: new Date(0),
      ...overrides,
    });
  }

  it('puts a document LightRAG still holds back in flight for a reprocess', async () => {
    const verdict = new Date('2026-09-17T00:30:00Z');
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const lightrag = makeLightragStub([], [heldAs('doc-1', 'failed', verdict)]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([failedRow()]);

    expect(outcomes[0].action).toBe('reprocess');
    expect(prisma.states['src-1']).toBe('processing');
    expect(prisma.errors['src-1']).toBeNull();
    expect(prisma.retryAt['src-1']).toBeNull();
    expect(prisma.docIds['src-1']).toBe('doc-1');
    // The verdict being re-queued over travels with the row.
    expect(prisma.requeuedOver['src-1']).toEqual(verdict);
    expect(lightrag.ingestText).not.toHaveBeenCalled();
  });

  it('takes the failed original a refusal named as the handle', async () => {
    // The row's own handle is the rejected duplicate, which LightRAG will
    // never process; the original is what a reprocess finishes.
    const prisma = makePrismaStub({ 'src-1': 'dup-1' });
    const lightrag = makeLightragStub([], [heldAs('doc-orig', 'failed')]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([
      failedRow({
        indexError:
          'Identical content already exists under another filename. Original doc_id: doc-orig, Status: failed',
      }),
    ]);

    expect(outcomes[0].action).toBe('reprocess');
    expect(prisma.docIds['src-1']).toBe('doc-orig');
  });

  it('resolves a refusal by filename through the listing', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([], [heldAs('doc-stored', 'failed')]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([
      failedRow({
        indexError: "LightRAG /documents/upload failed: 409 Document storage already contains 'notes.txt' (Status: failed)",
      }),
    ]);

    expect(outcomes[0].action).toBe('reprocess');
    expect(prisma.docIds['src-1']).toBe('doc-stored');
  });

  it('uploads again when LightRAG holds nothing under the handle', async () => {
    const prisma = makePrismaStub({ 'src-1': 'gone' });
    const lightrag = makeLightragStub([], []);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([failedRow()]);

    expect(outcomes[0].action).toBe('resent');
    expect(lightrag.ingestText).toHaveBeenCalledTimes(1);
    expect(prisma.docIds['src-1']).toBe('track-1');
    expect(prisma.states['src-1']).toBe('processing');
  });

  it('stamps a document that turned out processed after all', async () => {
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const lightrag = makeLightragStub([], [heldAs('doc-1', 'processed')]);
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([failedRow()]);

    expect(outcomes[0].action).toBe('indexed');
    expect(prisma.indexedAt['src-1']).toBeInstanceOf(Date);
    expect(prisma.attempts['src-1']).toBe(0);
  });

  it('reports a re-upload that failed again, recorded by the upload path', async () => {
    const prisma = makePrismaStub({ 'src-1': null });
    const lightrag = makeLightragStub([], []);
    lightrag.ingestText.mockRejectedValueOnce(new Error('fetch failed'));
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([failedRow()]);

    expect(outcomes[0]).toMatchObject({ action: 'failed', error: 'fetch failed' });
    expect(prisma.states['src-1']).toBe('failed');
    expect(prisma.attempts['src-1']).toBe(1);
  });
});

describe('SourceGateway.indexSources: a row the reconciler still owes a retry', () => {
  it('reports it without uploading or spending the attempt', async () => {
    const retryAt = new Date('2026-09-17T00:25:00Z');
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const lightrag = makeLightragStub(
      [],
      [{ id: 'doc-1', status: 'failed', filePath: 'notes.txt', errorMessage: 'RetryError[...]', updatedAt: null }],
    );
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource({
        indexState: 'failed',
        indexStatus: 'retrying',
        indexError: 'RetryError[...]',
        indexAttempts: 1,
        indexRetryAt: retryAt,
      }),
    ]);

    expect(outcomes[0]).toMatchObject({ status: 'failed', retryAt });
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(prisma.source.update).not.toHaveBeenCalled();
    expect(prisma.docIds['src-1']).toBe('doc-1');
  });
});

describe('SourceGateway.requestRetry (the Retry button on a row)', () => {
  function makeRecordStub(row: {
    lightragDocId: string | null;
    indexError: string | null;
    indexedAt: Date | null;
  }) {
    const prisma = makePrismaStub({ 'src-1': row.lightragDocId });
    prisma.source.findUnique.mockImplementation(() =>
      Promise.resolve({
        id: 'src-1',
        knowledgeId: 'knowledge-1',
        lightragDocId: row.lightragDocId,
        indexError: row.indexError,
        indexedAt: row.indexedAt,
        indexAttempts: 3,
        indexRetryAt: null,
        indexRequeuedOverAt: null,
      }),
    );
    return prisma;
  }

  it('hands a row LightRAG still holds to the reconciler, due now, count reset', async () => {
    const prisma = makeRecordStub({
      lightragDocId: 'doc-1',
      indexError: 'RetryError[...]',
      indexedAt: null,
    });
    const gateway = makeGateway(prisma, makeLightragStub([]));

    expect(await gateway.requestRetry(makeSource())).toBe(true);
    expect(prisma.attempts['src-1']).toBe(0);
    expect(prisma.retryAt['src-1']).toBeInstanceOf(Date);
    expect(prisma.states['src-1']).toBe('failed');
  });

  it('reads a duplicate refusal as LightRAG holding the document', async () => {
    const prisma = makeRecordStub({
      lightragDocId: null,
      indexError:
        'Identical content already exists under another filename. Original doc_id: doc-9, Status: failed',
      indexedAt: null,
    });
    const gateway = makeGateway(prisma, makeLightragStub([]));

    expect(await gateway.requestRetry(makeSource())).toBe(true);
  });

  it('leaves a failure about the document itself to the upload path', async () => {
    // Re-extracted scan, say: reprocessing the text-less copy LightRAG holds
    // fails the same way; the OCR text has to go up instead.
    const prisma = makeRecordStub({
      lightragDocId: 'doc-1',
      indexError: 'File content contains only whitespace characters',
      indexedAt: null,
    });
    const gateway = makeGateway(prisma, makeLightragStub([]));

    expect(await gateway.requestRetry(makeSource())).toBe(false);
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it('leaves a row with nothing to reprocess to the upload path', async () => {
    const prisma = makeRecordStub({
      lightragDocId: null,
      indexError: 'fetch failed',
      indexedAt: null,
    });
    const gateway = makeGateway(prisma, makeLightragStub([]));

    expect(await gateway.requestRetry(makeSource())).toBe(false);
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it('leaves an indexed row to the upload path even with a stale error', async () => {
    const prisma = makeRecordStub({
      lightragDocId: 'doc-1',
      indexError: 'old',
      indexedAt: new Date(0),
    });
    const gateway = makeGateway(prisma, makeLightragStub([]));

    expect(await gateway.requestRetry(makeSource())).toBe(false);
  });
});

describe('SourceGateway.waitForSourceIndexed: a refusal naming a processed original', () => {
  it('adopts it instead of recording a failure', async () => {
    const prisma = makePrismaStub({ 'src-1': 'track-1' });
    const lightrag = makeLightragStub([duplicateOf('doc-9', 'processed')]);
    const gateway = makeGateway(prisma, lightrag);

    const result = await gateway.waitForSourceIndexed('src-1');

    expect(prisma.docIds['src-1']).toBe('doc-9');
    expect(prisma.indexedAt['src-1']).toBeInstanceOf(Date);
    expect(prisma.errors['src-1']).toBeNull();
    expect(result.id).toBe('src-1');
  });
});

describe('SourceGateway: a LightRAG that takes the call and never answers', () => {
  function hung() {
    const lightrag = makeLightragStub([], []);
    lightrag.listDocuments.mockRejectedValue(
      new LightragTimeoutError('/documents', 30_000),
    );
    return lightrag;
  }

  it('does not upload into it: an index run reports every source and writes nothing', async () => {
    // Each upload would hang to its own two-minute limit, one after another;
    // on a base of a few hundred sources that is a day spent failing.
    const prisma = makePrismaStub();
    const lightrag = hung();
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.indexSources([
      makeSource(),
      makeSource({ id: 'src-2', name: 'b.txt' }),
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'failed']);
    expect(outcomes[0].error).toContain('LightRAG is not answering');
    expect(outcomes[0].error).toContain('/documents timed out after 30 s');
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(lightrag.getTrackStatus).not.toHaveBeenCalled();
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it('leaves in-flight rows alone on a reconcile pass', async () => {
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const lightrag = hung();
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.confirmProcessed([
      makeSource({ indexState: 'processing' }),
    ]);

    // Not `pending`: a stalled-pipeline nudge would only hang the same way.
    expect(outcomes[0].status).toBe('failed');
    expect(lightrag.getTrackStatus).not.toHaveBeenCalled();
    expect(prisma.source.update).not.toHaveBeenCalled();
    expect(prisma.docIds['src-1']).toBe('doc-1');
  });

  it('keeps due retries due instead of spending them', async () => {
    const prisma = makePrismaStub({ 'src-1': 'doc-1' });
    const lightrag = hung();
    const gateway = makeGateway(prisma, lightrag);

    const outcomes = await gateway.retryFailed([
      makeSource({
        indexState: 'failed',
        indexError: 'RetryError[...]',
        indexAttempts: 1,
        indexRetryAt: new Date(0),
      }),
    ]);

    expect(outcomes[0].action).toBe('failed');
    expect(lightrag.ingestText).not.toHaveBeenCalled();
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it('checks /health to say which kind of outage it is', async () => {
    const lightrag = hung();
    const gateway = makeGateway(makePrismaStub(), lightrag);

    await gateway.indexSources([makeSource()]);

    expect(lightrag.health).toHaveBeenCalledTimes(1);
  });

  it('still treats any other listing failure as non-fatal', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub([processed()]);
    lightrag.listDocuments.mockRejectedValue(new Error('LightRAG /documents failed: 502'));
    const gateway = makeGateway(prisma, lightrag);
    jest.useFakeTimers();
    try {
      const run = gateway.indexSources([makeSource()]);
      await jest.advanceTimersByTimeAsync(POLL_MS * 2);
      const outcomes = await run;

      expect(outcomes[0].indexed).toBe(true);
      expect(lightrag.ingestText).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
