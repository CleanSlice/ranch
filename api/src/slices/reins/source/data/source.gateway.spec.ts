import { SourceGateway } from './source.gateway';
import { SourceMapper } from './source.mapper';
import { ISourceData } from '../domain/source.types';
import {
  ITrackStatus,
  IDocumentRecord,
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
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function processed(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processed', errorMessage: null }],
  };
}

function stillProcessing(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processing', errorMessage: null }],
  };
}

function failed(message: string): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'failed', errorMessage: message }],
  };
}

interface IRowPatch {
  lightragDocId?: string | null;
  indexError?: string | null;
  indexedAt?: Date | null;
}

// Tracks the three columns indexSources writes, applying only the keys each
// update actually sends - the way Prisma does - so a `{ indexError }` write
// cannot be mistaken for clearing the doc id.
function makePrismaStub(docIds: Record<string, string | null> = {}) {
  const errors: Record<string, string | null> = {};
  const indexedAt: Record<string, Date | null> = {};
  return {
    docIds,
    errors,
    indexedAt,
    source: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ lightragDocId: docIds[where.id] ?? null }),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: IRowPatch }) => {
          if ('lightragDocId' in data) docIds[where.id] = data.lightragDocId!;
          if ('indexError' in data) errors[where.id] = data.indexError!;
          if ('indexedAt' in data) indexedAt[where.id] = data.indexedAt!;
          return Promise.resolve({ id: where.id });
        },
      ),
    },
  };
}

function inFlight(): ITrackStatus {
  return {
    documents: [{ id: 'doc-1', status: 'processing', errorMessage: null }],
  };
}

function duplicateOf(docId: string, originalStatus: string): ITrackStatus {
  return {
    documents: [
      {
        id: 'dup-1',
        status: 'failed',
        errorMessage: `Identical content already exists under another filename. Original doc_id: ${docId}, Status: ${originalStatus}`,
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
  };
}

type Prisma = ConstructorParameters<typeof SourceGateway>[0];
type Lightrag = ConstructorParameters<typeof SourceGateway>[2];
type S3 = ConstructorParameters<typeof SourceGateway>[3];
type KnowledgeConfig = ConstructorParameters<typeof SourceGateway>[4];

function makeGateway(
  prisma: ReturnType<typeof makePrismaStub>,
  lightrag: ReturnType<typeof makeLightragStub>,
): SourceGateway {
  // The gateway's constructor takes the full Prisma client and the S3/config
  // deps, but indexSources only touches `source` and the LightRAG client, so
  // structural stubs are enough. Same idiom as browser.gateway.spec.ts.
  return new SourceGateway(
    prisma as unknown as Prisma,
    new SourceMapper(),
    lightrag as unknown as Lightrag,
    {} as unknown as S3,
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
      },
    ]);
    expect(prisma.docIds['src-1']).toBe('track-existing');
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
      [{ id: 'doc-stored', status: 'processed', filePath: 'notes.txt' }],
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
    });
    expect(prisma.docIds['src-1']).toBe('doc-stored');
  });

  it('still fails when the stored document under that filename is not processed', async () => {
    const prisma = makePrismaStub();
    const lightrag = makeLightragStub(
      [processed()],
      [{ id: 'doc-stored', status: 'failed', filePath: 'notes.txt' }],
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
      [{ id: 'doc-stored', status: 'processing', filePath: 'notes.txt' }],
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
