import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SourceService } from '../../source/domain/source.service';
import {
  ISourceData,
  ISourceRetryOutcome,
} from '../../source/domain/source.types';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';

const DEFAULT_INTERVAL_SEC = 60;

/**
 * How long to leave a pipeline alone after nudging it. A nudge only re-queues
 * work LightRAG already holds, so the cost of one is a request; the cooldown
 * exists so a genuinely unprocessable backlog cannot turn every reconcile
 * pass into a restart. Shared by both paths that nudge (a stalled pipeline,
 * a due retry) so they cannot double up on one base.
 */
const RESTART_COOLDOWN_MS = 10 * 60 * 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function groupByKnowledge(sources: ISourceData[]): Map<string, ISourceData[]> {
  const groups = new Map<string, ISourceData[]>();
  for (const source of sources) {
    const group = groups.get(source.knowledgeId);
    if (group) group.push(source);
    else groups.set(source.knowledgeId, [source]);
  }
  return groups;
}

function tally(outcomes: ISourceRetryOutcome[]): string {
  const of = (action: ISourceRetryOutcome['action']): number =>
    outcomes.filter((o) => o.action === action).length;
  return `${of('reprocess')} reprocessed, ${of('resent')} re-sent, ${of('indexed')} already processed, ${of('failed')} failed again`;
}

/**
 * Confirms documents LightRAG finished after the index run that submitted them
 * had already stopped waiting, and retries the ones that failed for a reason
 * that passes.
 *
 * Why this exists: an index run waits a bounded time (see indexBudgetMs) and
 * then leaves whatever is still moving to be picked up later. On real content
 * that is the normal case, not the exception - a 1 MB manual is 217 chunks and
 * spends the better part of an hour in the pipeline, long after any run gave
 * up on it. Until something writes the confirmation down, the base keeps
 * reporting "2 of 3" and the only way to move it is for a person to press
 * Index again and hope the timing works out.
 *
 * So a timer does it instead. Each pass asks LightRAG about the handles it
 * already stored, stamps the ones that came back processed, records the ones
 * LightRAG gave up on, and leaves the rest alone.
 *
 * The retry step is the second reason. Bedrock fails in waves of ten to
 * fifteen minutes; LightRAG's own retry runs for seconds and marks the
 * document failed, and a re-upload is refused as a duplicate of that failed
 * copy, so nothing a person could press recovered it. A failure that reads
 * as transient (indexFailure.ts) gets a retry slot on its row; when it comes
 * due and the base's pipeline is idle, the row goes back in flight and the
 * pipeline is nudged to reprocess what it holds. Only a document LightRAG no
 * longer holds is uploaded again, and only within the row's attempt budget:
 * that is the one way a pass can start work that costs money, and it is
 * bounded by rows a person already asked to index.
 *
 * Ranch has no scheduler facility, so this is a plain `setInterval` in an
 * OnModuleInit service, the same pattern as chatSync.service and
 * agentStatus.service's driftTimer.
 */
@Injectable()
export class IndexReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexReconcileService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  /** Per knowledge: when its pipeline was last nudged, by either path. */
  private readonly lastNudgeAt = new Map<string, number>();

  constructor(
    private readonly sources: SourceService,
    private readonly lightrag: ILightragClient,
  ) {}

  onModuleInit(): void {
    const raw = process.env.KNOWLEDGE_RECONCILE_INTERVAL_SEC;
    const sec =
      raw === undefined || raw.trim() === ''
        ? DEFAULT_INTERVAL_SEC
        : Number(raw);
    if (!Number.isFinite(sec) || sec <= 0) {
      this.logger.log('index reconcile disabled');
      return;
    }
    this.logger.log(`index reconcile enabled: every ${sec}s`);
    this.timer = setInterval(() => {
      void this.reconcile().catch((err) =>
        this.logger.error(`scheduled reconcile failed: ${errorMessage(err)}`),
      );
    }, sec * 1000);
    // Nothing here should keep the process alive on its own.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass. Returns how many sources became searchable, so a caller (or a
   * test) can tell a productive pass from a quiet one.
   */
  async reconcile(): Promise<number> {
    // Passes must not overlap: LightRAG's status reads are slow enough on a
    // large base that a 60 s timer can fire again mid-pass, and two passes
    // would ask the same questions and write the same rows.
    if (this.running) return 0;
    this.running = true;
    try {
      const pending = await this.sources.findUnconfirmed();
      let confirmed = 0;
      // Per knowledge: sources still moving after this pass. Each base has
      // its own pipeline to ask about, so the count is kept per base.
      const stalled = new Map<string, number>();

      if (pending.length > 0) {
        const baseOf = new Map(pending.map((s) => [s.id, s.knowledgeId]));
        const outcomes = await this.sources.confirmProcessed(pending);
        confirmed = outcomes.filter((o) => o.indexed).length;
        let stillMoving = 0;
        for (const outcome of outcomes) {
          if (outcome.status !== 'pending') continue;
          stillMoving += 1;
          const base = baseOf.get(outcome.sourceId);
          if (base !== undefined) {
            stalled.set(base, (stalled.get(base) ?? 0) + 1);
          }
        }
        if (confirmed > 0) {
          this.logger.log(
            `reconcile confirmed ${confirmed} source(s); ${stillMoving} still in the pipeline`,
          );
        }
      }

      await this.retryDue();
      await this.restartIfStalled(stalled);
      return confirmed;
    } finally {
      this.running = false;
    }
  }

  /**
   * Failed rows whose retry slot has come. Each base is handled on its own:
   * a busy pipeline is left to finish (the rows stay due for the next pass),
   * a base nudged within the cooldown waits it out, and otherwise the rows
   * go back in flight and the pipeline is told to reprocess what it holds.
   * Failures here are swallowed per base: the retry is a bonus on top of a
   * reconcile pass, never a reason to lose one.
   */
  private async retryDue(): Promise<void> {
    const due = await this.sources.findDueForRetry(new Date());
    if (due.length === 0) return;

    for (const [knowledgeId, rows] of groupByKnowledge(due)) {
      // A row with a due slot and no attempt spent is a person pressing Retry;
      // making them wait out a cooldown they know nothing about reads as the
      // button doing nothing.
      const manual = rows.some((r) => r.indexAttempts === 0);
      if (!manual && this.nudgedRecently(knowledgeId)) continue;
      try {
        const status = await this.lightrag.getPipelineStatus(knowledgeId);
        if (status.busy) {
          this.logger.log(
            `${rows.length} source(s) due for retry in ${knowledgeId}; pipeline busy, next pass`,
          );
          continue;
        }
        const outcomes = await this.sources.retryFailed(rows);
        if (outcomes.some((o) => o.action === 'reprocess')) {
          // Stamped before the call: a restart that throws half-way may still
          // have started the pipeline.
          this.lastNudgeAt.set(knowledgeId, Date.now());
          await this.lightrag.restartPipeline(knowledgeId);
        }
        this.logger.log(
          `retrying ${rows.length} source(s) in ${knowledgeId}: ${tally(outcomes)}`,
        );
      } catch (err) {
        this.logger.error(
          `retry in ${knowledgeId} failed: ${errorMessage(err)}`,
        );
      }
    }
  }

  /**
   * Documents waiting on a pipeline that is not running.
   *
   * LightRAG keeps its queue in the process and the document statuses in its
   * database, so the two part company the moment that process is replaced: the
   * rows still say PENDING, the queue that would have drained them is gone, and
   * nothing on either side notices. On 2026-09-01 a pod move at 15:27 left 271
   * documents in exactly that state and they sat there until a person went
   * looking, because every component was behaving correctly - LightRAG had
   * nothing queued, and this reconciler was politely waiting for documents no
   * one would ever process.
   *
   * "Still moving" plus "not busy" is that state, and re-queueing is the whole
   * remedy. Failures are swallowed: recovery is a bonus on top of a reconcile
   * pass, never a reason to lose one.
   */
  private async restartIfStalled(stalled: Map<string, number>): Promise<void> {
    for (const [knowledgeId, count] of stalled) {
      if (this.nudgedRecently(knowledgeId)) continue;
      try {
        const status = await this.lightrag.getPipelineStatus(knowledgeId);
        if (status.busy) continue;

        this.lastNudgeAt.set(knowledgeId, Date.now());
        await this.lightrag.restartPipeline(knowledgeId);
        this.logger.warn(
          `pipeline of ${knowledgeId} idle with ${count} source(s) waiting; re-queued the backlog`,
        );
      } catch (err) {
        this.logger.error(
          `pipeline restart for ${knowledgeId} failed: ${errorMessage(err)}`,
        );
      }
    }
  }

  private nudgedRecently(knowledgeId: string): boolean {
    const at = this.lastNudgeAt.get(knowledgeId);
    if (at === undefined) return false;
    if (Date.now() - at < RESTART_COOLDOWN_MS) return true;
    // Expired: forget it, so the map does not keep a stamp per base ever seen.
    this.lastNudgeAt.delete(knowledgeId);
    return false;
  }
}
