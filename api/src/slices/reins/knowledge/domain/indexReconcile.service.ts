import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SourceService } from '../../source/domain/source.service';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';

const DEFAULT_INTERVAL_SEC = 60;

/**
 * How long to leave an idle pipeline alone after nudging it. A nudge only
 * re-queues work LightRAG already holds, so the cost of one is a request; the
 * cooldown exists so a genuinely unprocessable backlog cannot turn every
 * reconcile pass into a restart.
 */
const RESTART_COOLDOWN_MS = 10 * 60 * 1000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Confirms documents LightRAG finished after the index run that submitted them
 * had already stopped waiting.
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
 * already stored, stamps the ones that came back processed, and leaves the
 * rest alone. It never uploads anything - re-sending a document is the Index
 * action's job - so a pass costs a couple of status reads and cannot start
 * work that costs money.
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
  private lastRestartAt = 0;

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
      if (pending.length === 0) return 0;

      const outcomes = await this.sources.confirmProcessed(pending);
      const confirmed = outcomes.filter((o) => o.indexed).length;
      const stillMoving = outcomes.filter((o) => o.status === 'pending').length;

      if (confirmed > 0) {
        this.logger.log(
          `reconcile confirmed ${confirmed} source(s); ${stillMoving} still in the pipeline`,
        );
      }

      await this.restartIfStalled(stillMoving);
      return confirmed;
    } finally {
      this.running = false;
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
  private async restartIfStalled(stillMoving: number): Promise<void> {
    if (stillMoving === 0) return;
    if (Date.now() - this.lastRestartAt < RESTART_COOLDOWN_MS) return;

    try {
      const status = await this.lightrag.getPipelineStatus();
      if (status.busy) return;

      // Stamped before the call, not after: a restart that throws half-way may
      // still have started the pipeline, and retrying it every minute is worse
      // than waiting out one cooldown.
      this.lastRestartAt = Date.now();
      await this.lightrag.restartPipeline();
      this.logger.warn(
        `pipeline idle with ${stillMoving} source(s) waiting; re-queued the backlog`,
      );
    } catch (err) {
      this.logger.error(`pipeline restart failed: ${errorMessage(err)}`);
    }
  }
}
