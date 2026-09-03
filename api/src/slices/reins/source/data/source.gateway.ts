import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { S3Repository } from '#/aws/s3';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import {
  DocumentProcessingStatusTypes,
  IDocumentRecord,
} from '../../lightrag/domain/lightrag.types';
import { ISourceGateway } from '../domain/source.gateway';
import {
  ISourceData,
  ICreateSourceData,
  ISourceContent,
  ISourceCounts,
  ISourceFilter,
  ISourceIndexStatePatch,
  ISourcePage,
  ISourceSelection,
  IUploadSourceFileInput,
  IUploadSourceStreamInput,
  IUploadedSourceFile,
  ISourceIndexOutcome,
} from '../domain/source.types';
import { indexBudgetMs, pollIntervalMs } from '../domain/indexBudget';
import { SourceMapper } from './source.mapper';

// LightRAG processes ingested documents in a background pipeline. How long one
// index run waits for it comes from indexBudgetMs, which scales with the
// batch's content volume: see the note there on why neither a constant nor a
// per-document figure can work.
// The per-source wait (waitForSourceIndexed) has no batch to size a budget
// from, so it keeps a flat deadline. Generous: a large PDF through entity
// extraction takes minutes, and an expired deadline marks the source failed
// (retryable), never silently indexed.
const TRACK_POLL_INTERVAL_MS = 3_000;
const TRACK_POLL_TIMEOUT_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type IExistingIndexCheck =
  // `docId` is the handle LightRAG confirmed as processed. The caller needs it
  // to stamp rows that never got one: a run that stopped waiting leaves the
  // row pending with a handle, and this is where it finally becomes indexed.
  | { kind: 'indexed'; docId: string }
  | { kind: 'inFlight'; trackId: string }
  | { kind: 'stale' }
  | { kind: 'unknown'; error: string };

// "Identical content already exists under another filename. Original doc_id:
// doc-abc123, Status: processed" - only worth adopting when that original is
// itself processed; a failed original has nothing to offer.
// Deliberately lenient about the id itself: a stricter pattern would silently
// stop adopting the day LightRAG changes its id format, putting the duplicate
// loop back.
const DUPLICATE_OF = /Original doc_id:\s*(\S+?),?\s*Status:\s*(\w+)/i;

// "Document storage already contains 'some-file.md' (Status: processed)" -
// this refusal names the file but never the doc id, so the id has to come from
// the document listing.
const ALREADY_STORED = /Document storage already contains ['"]([^'"]+)['"]/i;

interface IDocumentSnapshot {
  byId: Map<string, DocumentProcessingStatusTypes>;
  byName: Map<string, IDocumentRecord>;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function adoptableDocId(message: string | null): string | null {
  if (message === null) return null;
  const match = DUPLICATE_OF.exec(message);
  if (match === null) return null;
  return match[2].toLowerCase() === 'processed' ? match[1] : null;
}

/**
 * Status filters in Prisma terms. `indexed` and `failed` are the two states
 * with a recorded fact (confirmation timestamp / error); `pending` is
 * everything else, including a document still moving through the pipeline.
 * Kept in sync with deriveIndexStatus in the mapper.
 */
function whereForStatus(
  status: ISourceFilter['status'],
): Prisma.SourceWhereInput {
  switch (status) {
    case 'indexed':
      return { indexedAt: { not: null } };
    case 'failed':
      return { indexedAt: null, indexError: { not: null } };
    case 'pending':
      return { indexedAt: null, indexError: null };
    case undefined:
      return {};
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * The list's filter as a Prisma clause. Shared by the paginated list and the
 * export so "everything matching what I am looking at" means the same rows in
 * both - the export is driven by the filter, not by 356 ids in a query string.
 */
function whereForFilter(
  knowledgeId: string,
  filter: Pick<ISourceFilter, 'search' | 'status' | 'type'>,
): Prisma.SourceWhereInput {
  const search = filter.search?.trim();
  return {
    knowledgeId,
    ...whereForStatus(filter.status),
    ...(filter.type ? { type: filter.type } : {}),
    ...(search
      ? { name: { contains: search, mode: 'insensitive' as const } }
      : {}),
  };
}

@Injectable()
export class SourceGateway extends ISourceGateway {
  private readonly logger = new Logger(SourceGateway.name);
  private lastLoggedBucket = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: SourceMapper,
    private readonly lightrag: ILightragClient,
    private readonly s3: S3Repository,
    private readonly knowledgeConfig: IKnowledgeConfigGateway,
  ) {
    super();
  }

  /**
   * Keys live under a shared `knowledges/` prefix, mirroring the
   * `agents/{agent-id}` layout, so the knowledge bucket can be shared with
   * agent data without either scattering folders across the bucket root.
   */
  private static keyFor(knowledgeId: string, filename: string): string {
    return `knowledges/${knowledgeId}/${crypto.randomUUID()}-${filename}`;
  }

  private async requireBucket(): Promise<string> {
    const cfg = await this.knowledgeConfig.resolve();
    if (!cfg.bucket) {
      this.logger.error(
        'knowledge/s3_bucket is not set — cannot upload source files',
      );
      throw new ServiceUnavailableException(
        'Knowledge S3 bucket is not configured',
      );
    }
    // Only on change, so a busy import doesn't repeat one constant per file.
    // Worth logging at all because this bucket comes from knowledge/s3_bucket
    // while its region/endpoint come from the integrations/* group - the two
    // are edited on different settings pages and drift apart easily.
    if (cfg.bucket !== this.lastLoggedBucket) {
      this.logger.log(`knowledge sources bucket resolved: ${cfg.bucket}`);
      this.lastLoggedBucket = cfg.bucket;
    }
    return cfg.bucket;
  }

  async findByKnowledgeId(knowledgeId: string): Promise<ISourceData[]> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findPage(
    knowledgeId: string,
    filter: ISourceFilter,
  ): Promise<ISourcePage> {
    const where = whereForFilter(knowledgeId, filter);
    // Oldest first, same as findByKnowledgeId: an import appends at the end,
    // so page 1 keeps showing the same rows while a bulk import is running.
    const [records, total] = await this.prisma.$transaction([
      this.prisma.source.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (filter.page - 1) * filter.perPage,
        take: filter.perPage,
      }),
      this.prisma.source.count({ where }),
    ]);
    return {
      items: records.map((r) => this.mapper.toEntity(r)),
      total,
      page: filter.page,
      perPage: filter.perPage,
    };
  }

  async findForExport(
    knowledgeId: string,
    selection: ISourceSelection,
  ): Promise<ISourceData[]> {
    // An explicit id list wins over the filter: the caller ticked specific
    // rows, and re-deriving them from a filter that has since changed would
    // export something else.
    const where: Prisma.SourceWhereInput =
      selection.ids && selection.ids.length > 0
        ? { knowledgeId, id: { in: selection.ids } }
        : whereForFilter(knowledgeId, selection);
    const records = await this.prisma.source.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async countByKnowledgeIds(
    knowledgeIds: string[],
  ): Promise<Map<string, ISourceCounts>> {
    const counts = new Map<string, ISourceCounts>();
    if (knowledgeIds.length === 0) return counts;

    const groupCount = async (
      extra: Prisma.SourceWhereInput,
    ): Promise<Map<string, number>> => {
      const rows = await this.prisma.source.groupBy({
        by: ['knowledgeId'],
        where: { knowledgeId: { in: knowledgeIds }, ...extra },
        _count: { _all: true },
      });
      return new Map(rows.map((r) => [r.knowledgeId, r._count._all]));
    };

    const [total, indexed, failed, processing] = await Promise.all([
      groupCount({}),
      groupCount(whereForStatus('indexed')),
      groupCount(whereForStatus('failed')),
      // A stored handle with no `indexedAt` yet is the one state that means
      // "LightRAG has it and is working on it". Rows never submitted have no
      // handle, so they stay plain pending.
      groupCount({
        ...whereForStatus('pending'),
        lightragDocId: { not: null },
      }),
    ]);

    for (const [knowledgeId, count] of total) {
      counts.set(knowledgeId, {
        total: count,
        indexed: indexed.get(knowledgeId) ?? 0,
        failed: failed.get(knowledgeId) ?? 0,
        processing: processing.get(knowledgeId) ?? 0,
      });
    }
    return counts;
  }

  async findById(id: string): Promise<ISourceData | null> {
    const record = await this.prisma.source.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateSourceData): Promise<ISourceData> {
    const knowledge = await this.prisma.knowledge.findUnique({
      where: { id: data.knowledgeId },
      select: { id: true },
    });
    if (!knowledge) {
      throw new NotFoundException(`Knowledge ${data.knowledgeId} not found`);
    }
    const record = await this.prisma.source.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  /**
   * Bulk insert. Used by the sitemap importer where N sequential round
   * trips to a remote Postgres (Neon, us-east-1) would otherwise blow past
   * any reasonable HTTP timeout. All items must belong to the same
   * knowledge - the existence check runs once for that knowledge. The
   * caller only ever needs the count back, so we skip the re-fetch that a
   * full ISourceData[] would require.
   */
  async createMany(data: ICreateSourceData[]): Promise<ISourceData[]> {
    if (data.length === 0) return [];
    const knowledgeId = data[0].knowledgeId;
    if (!data.every((d) => d.knowledgeId === knowledgeId)) {
      throw new BadRequestException(
        'createMany requires all items to share the same knowledgeId',
      );
    }
    const knowledge = await this.prisma.knowledge.findUnique({
      where: { id: knowledgeId },
      select: { id: true },
    });
    if (!knowledge) {
      throw new NotFoundException(`Knowledge ${knowledgeId} not found`);
    }
    const rows = data.map((d) => this.mapper.toCreate(d));
    await this.prisma.source.createMany({ data: rows });
    return [];
  }

  async delete(id: string): Promise<void> {
    await this.prisma.source.delete({ where: { id } });
  }

  async uploadFile(
    input: IUploadSourceFileInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = SourceGateway.keyFor(input.knowledgeId, input.filename);
    const stored = await this.s3.upload({
      bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async uploadFileStream(
    input: IUploadSourceStreamInput,
  ): Promise<IUploadedSourceFile> {
    const bucket = await this.requireBucket();
    const key = SourceGateway.keyFor(input.knowledgeId, input.filename);
    // S3Repository uploads buffers via PutObject; the custom/MinIO endpoint
    // doesn't accept unbounded streaming bodies. Archive entries are
    // processed one at a time, so materializing a single entry keeps peak
    // memory bounded to that one file - the same profile as uploadFile.
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new BadRequestException(
          'archive entry stream emitted a non-binary chunk',
        );
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const stored = await this.s3.upload({
      bucket,
      key,
      body: Buffer.concat(chunks),
      contentType: input.contentType,
    });
    return { url: stored.uri };
  }

  async deleteFile(url: string): Promise<void> {
    const location = S3Repository.parseUri(url);
    await this.s3.delete(location);
  }

  async readContent(source: ISourceData): Promise<ISourceContent> {
    if (source.type === 'text') {
      const text = source.content ?? '';
      const body = Buffer.from(text, 'utf8');
      return {
        filename: source.name.endsWith('.txt')
          ? source.name
          : `${source.name}.txt`,
        contentType: 'text/plain; charset=utf-8',
        contentLength: body.length,
        body: Readable.from([body]),
      };
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new NotFoundException(`Source ${source.id} has no stored file`);
      }
      const location = S3Repository.parseUri(source.url);
      const object = await this.s3.getObjectStream(location);
      return {
        filename: source.name,
        // The row's mime type was captured at upload time and is what the
        // browser needs to pick a viewer; the S3 header is a fallback.
        contentType:
          source.mimeType ?? object.contentType ?? 'application/octet-stream',
        contentLength: object.contentLength,
        body: object.body,
      };
    }
    if (source.type === 'url') {
      throw new BadRequestException(
        'url sources have no stored content; open the url directly',
      );
    }
    const exhaustive: never = source.type;
    throw new BadRequestException(`Unknown source type: ${String(exhaustive)}`);
  }

  /**
   * Ingest only enqueues: LightRAG hands back a track id and builds chunks,
   * embeddings and the graph in a background pipeline afterwards. Storing that
   * track id as proof of indexing is what let a knowledge base report `ready`
   * while its graph stayed empty and every query came back without context.
   *
   * So submit everything first, then wait for the pipeline to reach a terminal
   * state, and persist a doc id only for documents LightRAG reports as
   * processed. Anything that fails or never finishes keeps `lightragDocId`
   * null, which leaves `indexed` false so the next run retries it. Re-ingest
   * is safe: LightRAG addresses documents by content hash, so resubmitting the
   * same source converges on the same document instead of duplicating it.
   */
  async indexSources(sources: ISourceData[]): Promise<ISourceIndexOutcome[]> {
    const outcomes = new Map<string, ISourceIndexOutcome>();
    const inFlight = new Map<string, ISourceData>();

    // One snapshot per base of everything its instance holds, indexed both
    // ways: a rejected upload names either the original doc id or just the
    // filename, and both have to lead back to a document. A batch is one
    // base's in practice, but the cache keeps mixed batches correct.
    const snapshots = new Map<string, IDocumentSnapshot>();
    const snapshotFor = async (
      knowledgeId: string,
    ): Promise<IDocumentSnapshot> => {
      const cached = snapshots.get(knowledgeId);
      if (cached) return cached;
      const snapshot = await this.snapshotDocuments(knowledgeId);
      snapshots.set(knowledgeId, snapshot);
      return snapshot;
    };

    for (const source of sources) {
      const known = await snapshotFor(source.knowledgeId);
      const existing = await this.checkExistingIndex(source, known.byId);

      if (existing.kind === 'indexed') {
        // A row that never got its stamp is the whole reason this branch
        // writes at all. When a run stops waiting it leaves the source pending
        // with a handle; LightRAG finishes minutes later; and every run after
        // that recognised the document as processed but recorded nothing, so
        // the source sat at `pending` forever and the base never reached
        // "N of N". Stamping here is what makes the count converge.
        // A row that is already stamped and clean needs no write - on a base
        // of a few hundred sources that would be a few hundred pointless
        // updates per run.
        const needsStamp =
          source.indexedAt === null || source.indexError !== null;
        outcomes.set(
          source.id,
          needsStamp
            ? await this.succeed(source, existing.docId)
            : this.indexed(source),
        );
        continue;
      }
      if (existing.kind === 'inFlight') {
        // Already moving through the pipeline. Re-uploading here is what made
        // LightRAG answer 409 "Document storage already contains ..." for
        // every source when an index run overlapped a reprocess.
        inFlight.set(existing.trackId, source);
        continue;
      }
      if (existing.kind === 'unknown') {
        // Could not reach LightRAG to verify a claim we still hold. The row
        // keeps its doc id (it may well be fine), so writing an error here
        // would be invisible behind an "indexed" status; report it for this
        // run's summary only.
        outcomes.set(source.id, this.failed(source, existing.error));
        continue;
      }

      try {
        const trackId = await this.ingestByType(source);
        // Persist the handle before waiting on it. If this run dies (deploy,
        // crash, budget) the next one resumes from here instead of uploading
        // the same file again.
        await this.rememberHandle(source.id, trackId);
        inFlight.set(trackId, source);
      } catch (err) {
        const message = errorMessage(err);

        // LightRAG refuses an upload whose filename it already stores, and
        // says so with the filename only. Whether that is good news depends on
        // the stored document: processed means the content is searchable and
        // Ranch merely lost the id, still-moving means we should wait for it
        // rather than call the source broken.
        const stored = this.resolveStoredByName(message, known.byName);
        if (stored?.status === 'processed') {
          outcomes.set(source.id, await this.succeed(source, stored.id));
          continue;
        }
        if (stored !== null && stored.status !== 'failed') {
          inFlight.set(stored.id, source);
          continue;
        }

        outcomes.set(source.id, await this.fail(source, message));
      }
    }

    await this.awaitProcessing(inFlight, outcomes);

    const results: ISourceIndexOutcome[] = [];
    for (const s of sources) {
      results.push(
        outcomes.get(s.id) ??
          (await this.fail(s, 'LightRAG reported no state for this document')),
      );
    }
    return results;
  }

  async findUnconfirmed(): Promise<ISourceData[]> {
    const records = await this.prisma.source.findMany({
      where: {
        lightragDocId: { not: null },
        indexedAt: null,
        indexError: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  /**
   * One pass over documents LightRAG already holds. Deliberately narrower than
   * `indexSources`: it never uploads and never waits, so it is safe to run on a
   * timer. Anything still moving is left for the next pass; anything LightRAG
   * has lost keeps its row untouched and waits for a real index run to re-send
   * it.
   */
  async confirmProcessed(
    sources: ISourceData[],
  ): Promise<ISourceIndexOutcome[]> {
    if (sources.length === 0) return [];
    // The reconcile pass sweeps across every knowledge, so snapshot each
    // base's instance once and reuse it for that base's sources.
    const snapshots = new Map<string, IDocumentSnapshot>();
    const outcomes: ISourceIndexOutcome[] = [];

    for (const source of sources) {
      let known = snapshots.get(source.knowledgeId);
      if (!known) {
        known = await this.snapshotDocuments(source.knowledgeId);
        snapshots.set(source.knowledgeId, known);
      }
      const existing = await this.checkExistingIndex(source, known.byId);
      if (existing.kind === 'indexed') {
        outcomes.push(await this.succeed(source, existing.docId));
        continue;
      }
      if (existing.kind === 'inFlight') {
        outcomes.push(
          this.stillProcessing(source, 'still in LightRAG pipeline'),
        );
        continue;
      }
      // 'stale' or 'unknown'. Neither is this pass's business: re-sending a
      // document is what the Index action is for, and an unreachable LightRAG
      // resolves itself. Report without writing.
      outcomes.push(
        this.failed(
          source,
          existing.kind === 'unknown'
            ? existing.error
            : 'LightRAG no longer holds this document',
        ),
      );
    }
    return outcomes;
  }

  private failed(source: ISourceData, error: string): ISourceIndexOutcome {
    return {
      sourceId: source.id,
      name: source.name,
      status: 'failed',
      indexed: false,
      error,
    };
  }

  private stillProcessing(
    source: ISourceData,
    reason: string,
  ): ISourceIndexOutcome {
    return {
      sourceId: source.id,
      name: source.name,
      status: 'pending',
      indexed: false,
      error: reason,
    };
  }

  private indexed(source: ISourceData): ISourceIndexOutcome {
    return {
      sourceId: source.id,
      name: source.name,
      status: 'indexed',
      indexed: true,
      error: null,
    };
  }

  /**
   * Records the outcome on the row so the sources table can show what
   * happened to each document, then returns the outcome for the run summary.
   * `succeed` also stores the doc id, which is what flips `indexed`.
   */
  private async succeed(
    source: ISourceData,
    docId: string,
  ): Promise<ISourceIndexOutcome> {
    await this.prisma.source.update({
      where: { id: source.id },
      data: {
        lightragDocId: docId,
        indexState: 'indexed',
        indexedAt: new Date(),
        indexError: null,
      },
    });
    return this.indexed(source);
  }

  /**
   * Hands one source to the retrieval service and marks it processing. The
   * per-source path (migration, single-source retry); batch runs go through
   * `indexSources`, which additionally reconciles duplicates and budgets its
   * wait.
   */
  async indexSource(source: ISourceData): Promise<void> {
    await this.updateIndexState(source.id, {
      indexState: 'processing',
      indexError: null,
    });
    let docId: string;
    try {
      docId = await this.ingestByType(source);
    } catch (err) {
      await this.updateIndexState(source.id, {
        indexState: 'failed',
        indexError: errorMessage(err),
      });
      throw err;
    }
    await this.rememberHandle(source.id, docId);
  }

  private async fail(
    source: ISourceData,
    error: string,
  ): Promise<ISourceIndexOutcome> {
    await this.prisma.source.update({
      where: { id: source.id },
      data: { indexState: 'failed', indexError: error },
    });
    return this.failed(source, error);
  }

  /**
   * The document is in LightRAG's pipeline and this run stopped waiting for
   * it. Storing the handle is what makes the next run resume the wait instead
   * of re-uploading the file and colliding with the copy already in there; the
   * row stays `pending` because `indexedAt` is untouched, and any error from
   * an earlier attempt goes away since nothing is wrong with it right now.
   */
  private async markInFlight(
    source: ISourceData,
    handle: string,
    reason: string,
  ): Promise<ISourceIndexOutcome> {
    await this.prisma.source.update({
      where: { id: source.id },
      data: {
        lightragDocId: handle,
        indexState: 'processing',
        indexError: null,
      },
    });
    return this.stillProcessing(source, reason);
  }

  private async clearError(sourceId: string): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { indexError: null },
    });
  }

  private async snapshotDocuments(
    knowledgeId: string,
  ): Promise<IDocumentSnapshot> {
    const empty: IDocumentSnapshot = { byId: new Map(), byName: new Map() };
    try {
      const documents = await this.lightrag.listDocuments(knowledgeId);
      const snapshot: IDocumentSnapshot = {
        byId: new Map(),
        byName: new Map(),
      };
      for (const doc of documents) {
        snapshot.byId.set(doc.id, doc.status);
        if (doc.filePath !== null) {
          snapshot.byName.set(normalizeName(doc.filePath), doc);
        }
      }
      return snapshot;
    } catch (err) {
      // Not fatal: the per-source track lookups still work, the snapshot only
      // helps reconcile documents Ranch has lost the id for.
      this.logger.warn(`listDocuments failed: ${errorMessage(err)}`);
      return empty;
    }
  }

  /**
   * Pulls the filename out of LightRAG's refusal and returns the document it
   * refers to, status included. The caller decides what that status is worth:
   * a processed document can be adopted outright, one still in the pipeline is
   * worth waiting for, and a failed one is left to be reported.
   */
  private resolveStoredByName(
    message: string,
    byName: Map<string, IDocumentRecord>,
  ): IDocumentRecord | null {
    const match = ALREADY_STORED.exec(message);
    if (match === null) return null;
    return byName.get(normalizeName(match[1])) ?? null;
  }

  /** Stores the resume handle without claiming the document is searchable. */
  private async rememberHandle(
    sourceId: string,
    handle: string,
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { lightragDocId: handle, indexState: 'processing' },
    });
  }

  /**
   * Classifies what LightRAG currently knows about a source that claims to be
   * indexed. The distinction that matters is between "gone or failed" (re-send
   * it) and "still in the pipeline" (wait for it) - conflating the two made an
   * index run fight an in-progress reprocess.
   */
  private async checkExistingIndex(
    source: ISourceData,
    known: Map<string, DocumentProcessingStatusTypes>,
  ): Promise<IExistingIndexCheck> {
    // Ask about any source that carries a handle, not only ones we call
    // indexed: the handle is written at ingest time, so a source left pending
    // by an earlier run has one too, and that is exactly the case where
    // re-uploading would collide with the copy already in the pipeline.
    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    const storedId = record?.lightragDocId ?? null;
    if (storedId === null) return { kind: 'stale' };

    try {
      const status = await this.lightrag.getTrackStatus(
        source.knowledgeId,
        storedId,
      );
      const statuses =
        status.documents.length > 0
          ? status.documents.map((d) => d.status)
          : // Not a track id LightRAG knows. It may be a doc id adopted from a
            // duplicate rejection, so fall back to the snapshot.
            this.statusesFromSnapshot(storedId, known);

      if (statuses.length === 0) {
        await this.forgetDocId(source.id);
        return { kind: 'stale' };
      }
      if (statuses.every((s) => s === 'processed')) {
        return { kind: 'indexed', docId: storedId };
      }
      if (statuses.some((s) => s === 'pending' || s === 'processing')) {
        return { kind: 'inFlight', trackId: storedId };
      }
    } catch (err) {
      // Cannot tell either way, so keep the existing claim and report the
      // source as unverified for this run rather than re-ingesting blindly.
      return { kind: 'unknown', error: errorMessage(err) };
    }

    // Failed, or a state we do not treat as in flight: drop the claim so this
    // run re-sends it.
    await this.forgetDocId(source.id);
    return { kind: 'stale' };
  }

  private statusesFromSnapshot(
    docId: string,
    known: Map<string, DocumentProcessingStatusTypes>,
  ): DocumentProcessingStatusTypes[] {
    const status = known.get(docId);
    return status ? [status] : [];
  }

  private async forgetDocId(sourceId: string): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { lightragDocId: null },
    });
  }

  private async awaitProcessing(
    inFlight: Map<string, ISourceData>,
    outcomes: Map<string, ISourceIndexOutcome>,
  ): Promise<void> {
    if (inFlight.size === 0) return;

    const budgetMs = indexBudgetMs([...inFlight.values()]);
    const deadline = Date.now() + budgetMs;

    while (inFlight.size > 0 && Date.now() < deadline) {
      // Recomputed each tick: the batch shrinks as documents land, so a run
      // speeds back up towards the 3 s floor as it nears the end.
      await sleep(pollIntervalMs(inFlight.size));

      for (const [trackId, source] of [...inFlight]) {
        try {
          const status = await this.lightrag.getTrackStatus(
            source.knowledgeId,
            trackId,
          );
          if (status.documents.length === 0) continue;

          const failure = status.documents.find((d) => d.status === 'failed');
          if (failure) {
            inFlight.delete(trackId);

            // LightRAG deduplicates by content hash. When the same text is
            // already stored under another filename it refuses the upload and
            // names the original. If that original is processed the content is
            // searchable, so adopt its id rather than reporting a failure the
            // next run would only reproduce.
            const adopted = adoptableDocId(failure.errorMessage);
            if (adopted !== null) {
              outcomes.set(source.id, await this.succeed(source, adopted));
              continue;
            }

            outcomes.set(
              source.id,
              await this.fail(
                source,
                failure.errorMessage ?? 'LightRAG failed to process it',
              ),
            );
            continue;
          }

          if (status.documents.every((d) => d.status === 'processed')) {
            inFlight.delete(trackId);
            outcomes.set(source.id, await this.succeed(source, trackId));
          }
        } catch (err) {
          // Transient read failure. Leave it in flight and retry next tick;
          // the deadline is what stops an endlessly unreachable LightRAG.
          this.logger.warn(
            `track_status(${trackId}) failed: ${errorMessage(err)}`,
          );
        }
      }
    }

    const waitedMinutes = Math.round(budgetMs / 60000);
    for (const [handle, source] of inFlight) {
      outcomes.set(
        source.id,
        await this.markInFlight(
          source,
          handle,
          `still processing after ${waitedMinutes} min - the next index run will pick it up`,
        ),
      );
    }
  }

  async waitForSourceIndexed(sourceId: string): Promise<ISourceData> {
    const record = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
    if (!record) throw new NotFoundException(`Source ${sourceId} not found`);
    if (!record.lightragDocId) {
      return this.mapper.toEntity(record);
    }

    const deadline = Date.now() + TRACK_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const track = await this.lightrag.getTrackStatus(
        record.knowledgeId,
        record.lightragDocId,
      );
      // One track id can cover several documents (an archive upload); the
      // source is indexed only when every one of them is processed, failed as
      // soon as any is. An empty answer means LightRAG has not registered the
      // track yet - keep waiting.
      const failure = track.documents.find((d) => d.status === 'failed');
      if (failure) {
        await this.updateIndexState(sourceId, {
          indexState: 'failed',
          indexError: failure.errorMessage ?? 'processing failed',
        });
        return this.requireEntity(sourceId);
      }
      if (
        track.documents.length > 0 &&
        track.documents.every((d) => d.status === 'processed')
      ) {
        await this.updateIndexState(sourceId, {
          indexState: 'indexed',
          indexError: null,
          indexedAt: new Date(),
        });
        return this.requireEntity(sourceId);
      }
      await sleep(TRACK_POLL_INTERVAL_MS);
    }
    await this.updateIndexState(sourceId, {
      indexState: 'failed',
      indexError: `processing did not finish within ${TRACK_POLL_TIMEOUT_MS / 60000} minutes`,
    });
    return this.requireEntity(sourceId);
  }

  async updateIndexState(
    id: string,
    patch: ISourceIndexStatePatch,
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id },
      data: {
        indexState: patch.indexState,
        ...(patch.indexError !== undefined && { indexError: patch.indexError }),
        ...(patch.indexedAt !== undefined && { indexedAt: patch.indexedAt }),
      },
    });
  }

  private async requireEntity(id: string): Promise<ISourceData> {
    const record = await this.prisma.source.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Source ${id} not found`);
    return this.mapper.toEntity(record);
  }

  async removeFromIndex(source: ISourceData): Promise<void> {
    const record = await this.prisma.source.findUnique({
      where: { id: source.id },
      select: { lightragDocId: true },
    });
    if (!record?.lightragDocId) return;
    await this.lightrag.deleteDocumentsByTrackIds(source.knowledgeId, [
      record.lightragDocId,
    ]);
  }

  async removeAllByKnowledge(knowledgeId: string): Promise<void> {
    const records = await this.prisma.source.findMany({
      where: { knowledgeId, lightragDocId: { not: null } },
      select: { lightragDocId: true },
    });
    const trackIds = records
      .map((r) => r.lightragDocId)
      .filter((v): v is string => v !== null);
    if (trackIds.length === 0) return;
    await this.lightrag.deleteDocumentsByTrackIds(knowledgeId, trackIds);
  }

  private async ingestByType(source: ISourceData): Promise<string> {
    const knowledgeId = source.knowledgeId;
    // file_source carries the source id so a returned reference resolves to
    // a Source row deterministically — names and URLs are not unique
    // (research R4). File uploads keep the filename: upstream's upload
    // endpoint has no file_source, and file names are deduped per base.
    if (source.type === 'text') {
      if (!source.content) {
        throw new Error(`Source ${source.id} has no content`);
      }
      const res = await this.lightrag.ingestText({
        knowledgeId,
        text: source.content,
        fileSource: source.id,
      });
      return res.docId;
    }
    if (source.type === 'url') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const res = await this.lightrag.ingestUrl({
        knowledgeId,
        url: source.url,
        fileSource: source.id,
      });
      return res.docId;
    }
    if (source.type === 'file') {
      if (!source.url) {
        throw new Error(`Source ${source.id} has no url`);
      }
      const location = S3Repository.parseUri(source.url);
      const buffer = await this.s3.download(location);
      const res = await this.lightrag.ingestFile({
        knowledgeId,
        filename: source.name,
        mimeType: source.mimeType ?? 'application/octet-stream',
        content: buffer,
      });
      return res.docId;
    }
    const exhaustive: never = source.type;
    throw new Error(`Unknown source type: ${String(exhaustive)}`);
  }
}
