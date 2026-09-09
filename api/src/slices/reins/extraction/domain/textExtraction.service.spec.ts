import { TextExtractionService } from './textExtraction.service';
import {
  IPdfTextProbe,
  ISourceObjectStore,
  ITextExtractionGateway,
} from './textExtraction.gateway';
import {
  IObjectLocation,
  IPdfProbeResult,
  ITextExtractionInput,
} from './textExtraction.types';
import { ISourceGateway } from '../../source/domain/source.gateway';
import {
  ISourceData,
  ISourceTextStatePatch,
  SourceTextStateTypes,
} from '../../source/domain/source.types';
import { ImportJobRegistry } from '../../source/domain/importJob.registry';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

function pdf(id: string, overrides: Partial<ISourceData> = {}): ISourceData {
  return {
    id,
    knowledgeId: 'k1',
    type: 'file',
    name: `${id}.pdf`,
    url: `s3://bucket/knowledges/k1/${id}.pdf`,
    mimeType: 'application/pdf',
    content: null,
    sizeBytes: 1000,
    indexed: false,
    indexStatus: 'pending',
    indexState: 'queued',
    indexError: 'left over from an earlier run',
    indexedAt: null,
    textState: 'none',
    textUrl: null,
    textError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** Rows in memory; records every text-state write in order. */
class SourcesStub {
  readonly rows = new Map<string, ISourceData>();
  readonly writes: Array<{ id: string; patch: ISourceTextStatePatch }> = [];
  readonly resets: string[] = [];

  constructor(rows: ISourceData[]) {
    for (const r of rows) this.rows.set(r.id, r);
  }
  async findById(id: string): Promise<ISourceData | null> {
    return this.rows.get(id) ?? null;
  }
  async updateTextState(id: string, patch: ISourceTextStatePatch): Promise<void> {
    this.writes.push({ id, patch });
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, {
      ...row,
      textState: patch.textState,
      textUrl: patch.textUrl === undefined ? row.textUrl : patch.textUrl,
      textError: patch.textError === undefined ? row.textError : patch.textError,
    });
  }
  async findByTextState(state: SourceTextStateTypes): Promise<ISourceData[]> {
    return [...this.rows.values()].filter((r) => r.textState === state);
  }
  async resetIndexClaim(source: ISourceData): Promise<void> {
    this.resets.push(source.id);
  }
}

class StoreStub implements ISourceObjectStore {
  readonly writes: Array<{ uri: string; body: string }> = [];
  locate(uri: string): IObjectLocation {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (!m) throw new Error(`not an object uri: ${uri}`);
    return { bucket: m[1], key: m[2] };
  }
  async read(): Promise<Buffer> {
    return Buffer.from('%PDF-1.4 bytes');
  }
  async writeText(uri: string, text: string): Promise<void> {
    this.writes.push({ uri, body: text });
  }
}

interface HarnessOptions {
  rows: ISourceData[];
  probe: IPdfProbeResult;
  ocr?: (input: ITextExtractionInput) => Promise<string>;
  ocrEnabled?: boolean;
  maxPages?: number;
}

function makeHarness(o: HarnessOptions) {
  const sources = new SourcesStub(o.rows);
  const store = new StoreStub();
  const ocrCalls: ITextExtractionInput[] = [];
  const probe: IPdfTextProbe = { probe: async () => o.probe };
  const ocr: ITextExtractionGateway = {
    extractText: async (input) => {
      ocrCalls.push(input);
      return o.ocr ? o.ocr(input) : '--- page 1 ---\nrecognised';
    },
  };
  const config = {
    isOcrEnabled: async () => o.ocrEnabled ?? true,
    getOcrMaxPages: async () => o.maxPages ?? 500,
  } as unknown as IKnowledgeConfigGateway;
  const imports = new ImportJobRegistry();
  const service = new TextExtractionService(
    sources as unknown as ISourceGateway,
    store,
    probe,
    ocr,
    config,
    imports,
  );
  return { service, sources, store, ocrCalls, imports };
}

const SCAN: IPdfProbeResult = { text: '', pages: 1 };
const TEXTUAL: IPdfProbeResult = { text: 'Real text. '.repeat(20), pages: 1 };

describe('TextExtractionService', () => {
  it('leaves a PDF that has its own text alone, and stores nothing', async () => {
    const h = makeHarness({ rows: [pdf('a')], probe: TEXTUAL });

    await h.service.schedule(h.sources.rows.get('a')!);
    await h.service.drain();

    expect(h.sources.rows.get('a')?.textState).toBe('none');
    expect(h.ocrCalls).toHaveLength(0);
    expect(h.store.writes).toHaveLength(0);
  });

  it('runs OCR on a scan, stores the text next to the file, and marks the row ready', async () => {
    const h = makeHarness({ rows: [pdf('a')], probe: SCAN });

    await h.service.schedule(h.sources.rows.get('a')!);
    // The row reads pending the moment it is scheduled, before any work.
    expect(h.sources.rows.get('a')?.textState).toBe('pending');
    await h.service.drain();

    const row = h.sources.rows.get('a')!;
    expect(row.textState).toBe('ready');
    expect(row.textUrl).toBe('s3://bucket/knowledges/k1/a.pdf.ocr.txt');
    expect(row.textError).toBeNull();
    expect(h.store.writes[0]).toEqual({
      uri: 's3://bucket/knowledges/k1/a.pdf.ocr.txt',
      body: '--- page 1 ---\nrecognised',
    });
    expect(h.ocrCalls[0]).toEqual(
      expect.objectContaining({ bucket: 'bucket', key: 'knowledges/k1/a.pdf', pages: 1 }),
    );
    // A fresh row has no index claim to drop.
    expect(h.sources.resets).toHaveLength(0);
  });

  it('drops the old index entry when text lands on a row already indexed from the file', async () => {
    // A thin text layer (a page number, a letterhead) is enough for LightRAG
    // to accept the file, so such a row can be "indexed" and still worthless.
    // Re-extract must make the next run send the text instead.
    const h = makeHarness({
      rows: [pdf('a', { indexed: true, indexStatus: 'indexed' })],
      probe: SCAN,
    });

    await h.service.schedule(h.sources.rows.get('a')!);
    await h.service.drain();

    expect(h.sources.rows.get('a')?.textState).toBe('ready');
    expect(h.sources.resets).toEqual(['a']);
  });

  it('treats a file that does not open as a PDF as a failure, not as a scan', async () => {
    const h = makeHarness({ rows: [pdf('a')], probe: { text: '', pages: 0 } });

    await h.service.schedule(h.sources.rows.get('a')!);
    await h.service.drain();

    const row = h.sources.rows.get('a')!;
    expect(row.textState).toBe('failed');
    expect(row.textError).toContain('could not be read as a PDF');
    expect(h.ocrCalls).toHaveLength(0);
  });

  it('records a reason that names the switch when OCR is disabled', async () => {
    const h = makeHarness({ rows: [pdf('a')], probe: SCAN, ocrEnabled: false });

    await h.service.schedule(h.sources.rows.get('a')!);
    await h.service.drain();

    const row = h.sources.rows.get('a')!;
    expect(row.textState).toBe('failed');
    expect(row.textError).toContain('OCR is disabled');
    expect(h.ocrCalls).toHaveLength(0);
  });

  it('refuses a scan over the page cap before spending anything', async () => {
    const h = makeHarness({
      rows: [pdf('a')],
      probe: { text: '', pages: 800 },
      maxPages: 500,
    });

    await h.service.schedule(h.sources.rows.get('a')!);
    await h.service.drain();

    const row = h.sources.rows.get('a')!;
    expect(row.textState).toBe('failed');
    expect(row.textError).toContain('800 pages');
    expect(row.textError).toContain('500');
    expect(h.ocrCalls).toHaveLength(0);
  });

  it('records an OCR failure on the row and leaves the index error to the index run', async () => {
    const h = makeHarness({
      rows: [pdf('a')],
      probe: SCAN,
      ocr: async () => {
        throw new Error('AccessDenied: textract:StartDocumentTextDetection');
      },
    });

    await h.service.schedule(h.sources.rows.get('a')!);
    await h.service.drain();

    const row = h.sources.rows.get('a')!;
    expect(row.textState).toBe('failed');
    expect(row.textError).toContain('AccessDenied');
    // Never touched: that column belongs to the index run.
    expect(row.indexError).toBe('left over from an earlier run');
  });

  it('re-queues rows a previous process left pending', async () => {
    const h = makeHarness({
      rows: [pdf('a', { textState: 'pending' }), pdf('b')],
      probe: SCAN,
    });

    await h.service.onModuleInit();
    await h.service.drain();

    expect(h.sources.rows.get('a')?.textState).toBe('ready');
    expect(h.sources.rows.get('b')?.textState).toBe('none');
  });

  it('ignores anything that is not a PDF', async () => {
    const h = makeHarness({
      rows: [pdf('doc', { mimeType: 'application/msword', name: 'doc.docx' })],
      probe: SCAN,
    });

    expect(await h.service.schedule(h.sources.rows.get('doc')!)).toBe(false);
    await h.service.drain();
    expect(h.sources.writes).toHaveLength(0);
  });

  it('opens one progress job for a batch and closes it when every PDF is done', async () => {
    const h = makeHarness({
      rows: [pdf('a'), pdf('b'), pdf('note', { mimeType: 'text/plain', name: 'n.txt' })],
      probe: SCAN,
    });

    const jobId = await h.service.scheduleBatch('k1', [...h.sources.rows.values()]);
    expect(jobId).not.toBeNull();
    const before = h.imports.get(jobId!);
    expect(before).toEqual(expect.objectContaining({ kind: 'extraction', detected: 2 }));

    await h.service.drain();

    const after = h.imports.get(jobId!)!;
    expect(after.status).toBe('done');
    expect(after.added).toBe(2);
    expect(after.failed).toBe(0);
  });

  it('counts a failed PDF in the batch and still closes the job', async () => {
    const h = makeHarness({
      rows: [pdf('ok'), pdf('bad')],
      probe: SCAN,
      ocr: async (input) => {
        if (input.key.endsWith('bad.pdf')) throw new Error('Textract: bad file');
        return 'text';
      },
    });

    const jobId = await h.service.scheduleBatch('k1', [...h.sources.rows.values()]);
    await h.service.drain();

    const job = h.imports.get(jobId!)!;
    expect(job.status).toBe('done');
    expect(job.added).toBe(1);
    expect(job.failed).toBe(1);
    expect(job.errors[0]).toContain('Textract: bad file');
  });

  it('still records a terminal state and closes the batch when the row read itself throws', async () => {
    const h = makeHarness({ rows: [pdf('a')], probe: SCAN });
    const original = h.sources.findById.bind(h.sources);
    let reads = 0;
    h.sources.findById = async (id: string): Promise<ISourceData | null> => {
      reads += 1;
      if (reads === 1) throw new Error('connection reset');
      return original(id);
    };

    const jobId = await h.service.scheduleBatch('k1', [h.sources.rows.get('a')!]);
    await h.service.drain();

    // Without this the row read pending until the next boot and the strip
    // stayed at "running" forever.
    expect(h.sources.rows.get('a')?.textState).toBe('failed');
    expect(h.sources.rows.get('a')?.textError).toContain('connection reset');
    expect(h.imports.get(jobId!)?.status).toBe('done');
  });

  it('runs a source again when it is re-scheduled while its first pass is still running', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const h = makeHarness({
      rows: [pdf('a')],
      probe: SCAN,
      ocr: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return 'text';
      },
    });

    await h.service.schedule(h.sources.rows.get('a')!);
    // Give the first pass time to reach OCR, then re-schedule under it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await h.service.schedule(h.sources.rows.get('a')!);
    release?.();
    await h.service.drain();

    expect(calls).toBe(2);
    expect(h.sources.rows.get('a')?.textState).toBe('ready');
  });

  it('opens no job for a batch without a PDF in it', async () => {
    const h = makeHarness({
      rows: [pdf('note', { mimeType: 'text/plain', name: 'n.txt' })],
      probe: SCAN,
    });
    expect(await h.service.scheduleBatch('k1', [...h.sources.rows.values()])).toBeNull();
    expect(h.imports.listByKnowledge('k1')).toHaveLength(0);
  });

  it('never runs more than two extractions at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const h = makeHarness({
      rows: [pdf('a'), pdf('b'), pdf('c'), pdf('d')],
      probe: SCAN,
      ocr: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return 'text';
      },
    });

    for (const row of h.sources.rows.values()) await h.service.schedule(row);
    await h.service.drain();

    expect(peak).toBe(2);
    expect([...h.sources.rows.values()].every((r) => r.textState === 'ready')).toBe(true);
  });
});
