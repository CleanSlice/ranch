import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TranscriptReaderService } from '#/agent/file/domain';
import { captureBackgroundError } from '#/setup/sentry';
import { bucketByHour, hourOf } from './activityBuckets';
import { IChatActivityGateway, IUnsettledChat } from './chatActivity.gateway';
import { IChatSettleResult } from './chat.types';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SESSIONS_PREFIX = 'data/sessions/';

/**
 * How long a conversation has to be quiet before its transcript is read. The
 * cooldown the summary batch uses (ChatInsightService), so both read a
 * conversation at the same point in its life, and a transcript is read once
 * per quiet period, not once per message.
 */
export const QUIET_MS = 60 * MINUTE_MS;

/**
 * How far back the pass fills in: the longest period the statistics show (90
 * days) and the one before it, which the comparison needs. Older
 * conversations keep what was recorded live and are not read.
 */
export const HORIZON_MS = 180 * DAY_MS;

/**
 * How long an hour row is kept: the 90-day period and its predecessor, with a
 * year's margin so that a yearly view can be added later without new
 * collection (spec 038, FR-030).
 */
export const RETENTION_MS = 400 * DAY_MS;

/**
 * Seconds between runs, and conversations per run, unless
 * `STATS_SETTLE_INTERVAL_SEC` / `STATS_SETTLE_BATCH` say otherwise. A hundred
 * transcripts read one after another take 10 to 20 seconds, which leaves the
 * single API process free; every five minutes that is 28 800 a day, so
 * 100 000 conversations of history fill in about three and a half days, while
 * the live figures are right from the first minute.
 */
const DEFAULT_INTERVAL_SEC = 300;
const DEFAULT_BATCH = 100;

/** Retention is a matter of days; so is the prune. */
const PRUNE_EVERY_MS = DAY_MS;

/**
 * Failures in a row before a conversation is reported. One can be the
 * storage blinking; three runs apart it is a transcript that is not there.
 */
const REPORT_AFTER_FAILURES = 3;

/**
 * How long a conversation that has reached that number waits between further
 * attempts. The pass takes the newest first, a batch at a time: conversations
 * that fail on every run would be the whole batch of every run, and nothing
 * behind them would ever be read. An hour, the same patience the pass has
 * with a conversation that is still going.
 */
const RETRY_FAILED_MS = QUIET_MS;

interface IFailure {
  count: number;
  lastAt: number;
}

/**
 * Keeps `ChatActivityHour` true to the transcripts (CLEAN-261, spec 038
 * contracts/collection.md section 3, docs/statistics.md).
 *
 * The settle pass: on a timer it takes conversations that have gone quiet and
 * are due (`activityRebuiltAt` is null: never read, or a message or a changed
 * file has cleared it since), counts each transcript's messages per UTC hour,
 * and raises every stored hour that is lower. One path
 * for three needs: history when an installation is upgraded, events the live
 * write lost (the runtime reports a message once, and not at all while its
 * socket is down), and the past of a figure added later. It only ever raises,
 * because compaction shortens a transcript; that also makes a second run over
 * the same transcript change nothing.
 *
 * And once a day it removes the hours that are past their retention.
 *
 * Same setInterval pattern as ChatInsightService (ranch has no scheduler
 * facility, and the API is one process).
 */
@Injectable()
export class ChatActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatActivityService.name);
  private settleTimer?: ReturnType<typeof setInterval>;
  private pruneTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private batch = DEFAULT_BATCH;
  /**
   * Conversations whose last attempts failed, by id. In memory: a restart
   * forgets it, and the worst of that is one more report of a transcript
   * that is still unreadable.
   */
  private readonly failures = new Map<string, IFailure>();

  constructor(
    private readonly activity: IChatActivityGateway,
    private readonly reader: TranscriptReaderService,
  ) {}

  onModuleInit(): void {
    this.batch = batchFrom(process.env.STATS_SETTLE_BATCH);

    // Retention does not depend on the pass being on: the live write fills
    // the table either way. At boot as well as daily, because the API is
    // often restarted more than once a day and a timer alone would then
    // never come due.
    void this.pruneInBackground();
    this.pruneTimer = setInterval(
      () => void this.pruneInBackground(),
      PRUNE_EVERY_MS,
    );
    this.pruneTimer.unref?.();

    const sec = intervalSecFrom(process.env.STATS_SETTLE_INTERVAL_SEC);
    if (sec <= 0) {
      this.logger.log('activity settle pass is off');
      return;
    }
    this.logger.log(
      `activity settle pass enabled: every ${sec}s, up to ${this.batch} conversations`,
    );
    this.settleTimer = setInterval(() => {
      void this.settle().catch((err) => {
        this.logger.error(
          `activity settle pass failed: ${(err as Error).message}`,
        );
        captureBackgroundError(err, 'chat.activity');
      });
    }, sec * 1000);
    this.settleTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.settleTimer) clearInterval(this.settleTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.settleTimer = undefined;
    this.pruneTimer = undefined;
  }

  /**
   * One run. One at a time: a run that finds the previous one still going
   * does nothing, and says so with three zeros.
   */
  async settle(now: number = Date.now()): Promise<IChatSettleResult> {
    const result: IChatSettleResult = { picked: 0, raised: 0, failed: 0 };
    if (this.running) {
      this.logger.warn('activity settle pass already running — skipping');
      return result;
    }
    this.running = true;
    try {
      const setAside = this.setAsideAt(now);
      // Those set aside are still due as far as the database knows, and
      // would be handed back first. Asking for that many more keeps the
      // batch full of conversations that can be read.
      const due = await this.activity.findUnsettled({
        quietBefore: new Date(now - QUIET_MS),
        activeSince: new Date(now - HORIZON_MS),
        limit: this.batch + setAside.size,
      });
      const sessions = due
        .filter((s) => !setAside.has(s.id))
        .slice(0, this.batch);
      result.picked = sessions.length;

      for (const session of sessions) {
        try {
          result.raised += await this.settleOne(session, now);
          this.failures.delete(session.id);
        } catch (err) {
          result.failed++;
          this.noteFailure(session, err, now);
        }
      }
    } finally {
      this.running = false;
    }
    if (result.picked > 0) {
      this.logger.log(
        `activity settle: picked=${result.picked} raised=${result.raised} failed=${result.failed}`,
      );
    }
    return result;
  }

  /** Removes the hours past their retention. Returns how many. */
  async prune(now: number = Date.now()): Promise<number> {
    return this.activity.pruneBefore(new Date(now - RETENTION_MS));
  }

  private async settleOne(
    session: IUnsettledChat,
    now: number,
  ): Promise<number> {
    // The lines the live write counts: the runtime reports one activity per
    // stored user or assistant event, loop-control noise left out. So no
    // bubbles here. A streamed answer is one event shown as several bubbles,
    // and counting the bubbles would raise an hour above what was reported
    // live, an hour after the conversation ended.
    let messages: Awaited<ReturnType<TranscriptReaderService['read']>>;
    try {
      messages = await this.reader.read(
        session.agentId,
        `${SESSIONS_PREFIX}${session.sessionKey}.jsonl`,
        { types: ['user', 'assistant'], filterTransient: true, bubbles: false },
      );
    } catch (err) {
      // No transcript is not a transcript that cannot be read. There is
      // nothing to raise the hours to, what was counted live stands, and
      // trying again every run would warn about the same conversation for
      // ever (a session file removed by hand, an agent whose storage was
      // emptied). It is settled; its next message makes it due again, and
      // by then the file may be there.
      if (!(err instanceof NotFoundException)) throw err;
      await this.activity.markSettled(session.id, new Date(now));
      return 0;
    }
    // Not the hours the prune would delete. A conversation that began more
    // than the retention ago would get them back from its transcript every
    // time it was settled, and lose them again the next day. By the start of
    // the message's hour, which is what the prune compares.
    const keptFrom = now - RETENTION_MS;
    const kept = messages.filter((m) => hourOf(m.ts).getTime() >= keptFrom);
    const raised = await this.activity.raise(session, bucketByHour(kept));
    // The start of the run, not the end of the read: a message that arrives
    // while the transcript is being read is later than that, has made the
    // conversation due again, and the stamp is refused for it. So it is
    // picked up once it goes quiet.
    await this.activity.markSettled(session.id, new Date(now));
    return raised;
  }

  /**
   * Nothing is written for a conversation that could not be settled, so it
   * stays due and is tried again. Logged every time, reported once, when the
   * failures in a row reach three.
   */
  private noteFailure(session: IUnsettledChat, err: unknown, now: number) {
    const count = (this.failures.get(session.id)?.count ?? 0) + 1;
    this.failures.set(session.id, { count, lastAt: now });
    this.logger.warn(
      `activity settle failed for ${session.id} (${count} in a row): ${(err as Error).message}`,
    );
    if (count === REPORT_AFTER_FAILURES) {
      captureBackgroundError(err, 'chat.activity');
    }
  }

  private setAsideAt(now: number): Set<string> {
    const ids = new Set<string>();
    for (const [id, failure] of this.failures) {
      if (
        failure.count >= REPORT_AFTER_FAILURES &&
        now - failure.lastAt < RETRY_FAILED_MS
      ) {
        ids.add(id);
      }
    }
    return ids;
  }

  private async pruneInBackground(): Promise<void> {
    try {
      const removed = await this.prune();
      if (removed > 0) {
        this.logger.log(`activity prune: removed ${removed} hour rows`);
      }
    } catch (err) {
      this.logger.warn(`activity prune failed: ${(err as Error).message}`);
      captureBackgroundError(err, 'chat.activity');
    }
  }
}

/**
 * Not set, or set to nothing, is the default: the pass needs no setting.
 * `0` turns it off, and so does a value that is not a number, which is
 * better than guessing an interval somebody did not mean.
 */
function intervalSecFrom(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_INTERVAL_SEC;
  const sec = Number(raw);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function batchFrom(raw: string | undefined): number {
  const batch = Math.floor(Number(raw));
  return Number.isFinite(batch) && batch >= 1 ? batch : DEFAULT_BATCH;
}
