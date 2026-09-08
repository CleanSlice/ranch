import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { ISourceGateway } from '../../source/domain/source.gateway';
import { ISourceData } from '../../source/domain/source.types';
import { ImportJobRegistry } from '../../source/domain/importJob.registry';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';
import {
  IPdfTextProbe,
  ISourceObjectStore,
  ITextExtractionGateway,
} from './textExtraction.gateway';
import { IExtractionOutcome } from './textExtraction.types';
import { hasUsableTextLayer } from './pdfTextProbe';

/**
 * Two at a time per process. Each worker holds one PDF in memory (download
 * plus parse) on a 2 GiB pod, and Textract's default account limits are far
 * above two concurrent jobs. More would not be faster where it matters -
 * the asynchronous jobs run on Textract's side.
 */
const CONCURRENCY = 2;

const PDF_MIME = 'application/pdf';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isPdfSource(source: Pick<ISourceData, 'type' | 'mimeType'>): boolean {
  return source.type === 'file' && source.mimeType === PDF_MIME;
}

interface IBatch {
  jobId: string;
  detected: number;
  done: number;
}

/**
 * Gets a PDF that has no text layer to the point where the index run can
 * send text instead of the file.
 *
 * Owns the row's `textState`: nothing else writes it. The queue lives in
 * this process, like an index run; the row carries enough (`pending`) for
 * the next process to pick the work back up at boot.
 */
@Injectable()
export class TextExtractionService implements OnModuleInit {
  private readonly logger = new Logger(TextExtractionService.name);
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly batches = new Map<string, IBatch>();
  private readonly batchOf = new Map<string, string>();
  private active = 0;

  constructor(
    @Inject(forwardRef(() => ISourceGateway))
    private readonly sources: ISourceGateway,
    private readonly store: ISourceObjectStore,
    private readonly probe: IPdfTextProbe,
    private readonly ocr: ITextExtractionGateway,
    private readonly config: IKnowledgeConfigGateway,
    private readonly imports: ImportJobRegistry,
  ) {}

  /**
   * Rows left `pending` by a previous process: the queue died with it, the
   * object in S3 did not. Never blocks startup.
   */
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.sources.findByTextState('pending');
      for (const source of pending) this.enqueue(source.id);
      if (pending.length > 0) {
        this.logger.warn(
          `re-queued ${pending.length} text extraction(s) left pending by a previous process`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `could not re-queue pending extractions: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * Schedule one source. Non-PDFs are ignored so callers can hand over every
   * file they created without checking. Returns whether anything was queued.
   */
  async schedule(source: ISourceData, jobId?: string): Promise<boolean> {
    if (!isPdfSource(source)) return false;
    await this.sources.updateTextState(source.id, {
      textState: 'pending',
      textError: null,
    });
    if (jobId) this.batchOf.set(source.id, jobId);
    this.enqueue(source.id);
    return true;
  }

  /**
   * A batch shows one progress strip, not one per file. The job is created
   * here so the count is right before anything is queued; a batch with no
   * PDFs in it opens no job at all.
   */
  async scheduleBatch(
    knowledgeId: string,
    sources: ISourceData[],
  ): Promise<string | null> {
    const pdfs = sources.filter(isPdfSource);
    if (pdfs.length === 0) return null;
    const job = this.imports.create(knowledgeId, 'extraction', pdfs.length);
    this.batches.set(job.id, { jobId: job.id, detected: pdfs.length, done: 0 });
    for (const source of pdfs) await this.schedule(source, job.id);
    return job.id;
  }

  /** Resolves when nothing is queued or running. For tests and shutdown. */
  async drain(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private enqueue(sourceId: string): void {
    if (this.queued.has(sourceId)) return;
    this.queued.add(sourceId);
    this.queue.push(sourceId);
    this.pump();
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const sourceId = this.queue.shift();
      if (sourceId === undefined) return;
      // Out of the set as soon as it starts: a re-schedule that lands while
      // this one runs must queue a fresh pass, not vanish.
      this.queued.delete(sourceId);
      this.active += 1;
      void this.run(sourceId)
        .catch((err) =>
          this.logger.error(
            `extraction of ${sourceId} crashed: ${errorMessage(err)}`,
          ),
        )
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  private async run(sourceId: string): Promise<void> {
    let outcome: IExtractionOutcome;
    try {
      outcome = await this.extract(sourceId);
    } catch (err) {
      // extract() handles its own failures; this is the database going away
      // under it. The row must not read pending until the next boot, and the
      // batch strip must still reach its end.
      const reason = errorMessage(err);
      this.logger.error(`extraction of ${sourceId} crashed: ${reason}`);
      outcome = { sourceId, state: 'failed', reason };
      try {
        await this.sources.updateTextState(sourceId, {
          textState: 'failed',
          textError: reason,
        });
      } catch (writeErr) {
        this.logger.warn(
          `could not record the crash on ${sourceId}: ${errorMessage(writeErr)}`,
        );
      }
    }
    this.recordBatchProgress(outcome);
  }

  private async extract(sourceId: string): Promise<IExtractionOutcome> {
    const source = await this.sources.findById(sourceId);
    if (!source) {
      // Deleted while queued. Nothing to write anywhere.
      return { sourceId, state: 'none', reason: null };
    }
    try {
      const outcome = await this.extractFrom(source);
      return outcome;
    } catch (err) {
      const reason = errorMessage(err);
      await this.sources.updateTextState(sourceId, {
        textState: 'failed',
        textError: reason,
      });
      this.logger.warn(`text extraction failed for ${source.name}: ${reason}`);
      return { sourceId, state: 'failed', reason };
    }
  }

  private async extractFrom(source: ISourceData): Promise<IExtractionOutcome> {
    if (!source.url) throw new Error('source has no stored file');
    const location = this.store.locate(source.url);
    const bytes = await this.store.read(source.url);

    const probed = await this.probe.probe(bytes);
    if (probed.pages === 0) {
      throw new Error('file could not be read as a PDF');
    }
    if (hasUsableTextLayer(probed.text, probed.pages)) {
      // The common case, and free: the file goes to LightRAG as it is.
      await this.sources.updateTextState(source.id, {
        textState: 'none',
        textUrl: null,
        textError: null,
      });
      return { sourceId: source.id, state: 'none', reason: null };
    }

    if (!(await this.config.isOcrEnabled())) {
      throw new Error(
        'This PDF has no text layer and OCR is disabled in Settings > Knowledge',
      );
    }
    const maxPages = await this.config.getOcrMaxPages();
    if (probed.pages > maxPages) {
      throw new Error(
        `This PDF has no text layer and ${probed.pages} pages, over the OCR limit of ${maxPages} (Settings > Knowledge)`,
      );
    }

    const text = await this.ocr.extractText({
      bucket: location.bucket,
      key: location.key,
      bytes,
      pages: probed.pages,
    });

    const textUrl = `${source.url}.ocr.txt`;
    await this.store.writeText(textUrl, text);
    await this.sources.updateTextState(source.id, {
      textState: 'ready',
      textUrl,
      textError: null,
    });
    if (source.indexStatus !== 'pending') {
      // The index already holds (or tried to hold) the file itself, and an
      // index run trusts that claim before it looks at text state. Drop the
      // claim so the next run sends the text.
      try {
        await this.sources.resetIndexClaim(source);
      } catch (err) {
        this.logger.warn(
          `could not drop the old index entry for ${source.name}: ${errorMessage(err)}`,
        );
      }
    }
    this.logger.log(
      `extracted text for ${source.name}: ${probed.pages} page(s), ${text.length} chars`,
    );
    return { sourceId: source.id, state: 'ready', reason: null };
  }

  private recordBatchProgress(outcome: IExtractionOutcome): void {
    const jobId = this.batchOf.get(outcome.sourceId);
    if (!jobId) return;
    this.batchOf.delete(outcome.sourceId);
    const batch = this.batches.get(jobId);
    if (!batch) return;

    if (outcome.state === 'failed') {
      this.imports.progress(jobId, {
        failed: 1,
        error: `${outcome.sourceId}: ${outcome.reason ?? 'unknown error'}`,
      });
    } else {
      this.imports.progress(jobId, { added: 1 });
    }
    batch.done += 1;
    if (batch.done >= batch.detected) {
      this.imports.finish(jobId, 'done');
      this.batches.delete(jobId);
    }
  }
}
