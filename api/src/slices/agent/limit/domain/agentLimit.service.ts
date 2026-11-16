import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ApiInstanceService } from '#/setting/domain/apiInstance.service';
import { IAgentLimitGateway } from './agentLimit.gateway';
import {
  AgentLimitState,
  IAgentLimitHub,
  IAgentLimitSummary,
  IAgentLimits,
  IAgentLoadMinute,
  IAgentLoadSnapshot,
  IAgentLoadWindow,
  LIMIT_WINDOWS,
  LimitDecision,
  LimitWindow,
  RequestSource,
  WINDOW_MS,
  hasAnyLimit,
  limitFor,
} from './agentLimit.types';
import { admit, countIn, decide, rebuild, trim } from './slidingLog';

const MINUTE_MS = 60_000;

/**
 * How often counts go to the database. The same cadence the API already
 * heartbeats at (ApiInstanceService), so it adds no new write pattern, and a
 * crash loses at most ten seconds of counts.
 */
export const FLUSH_MS = 10_000;
/** How far back the "highest seen" figures look. */
export const PEAK_DAYS = 30;
const RETENTION_MS = PEAK_DAYS * WINDOW_MS.day;
const PRUNE_EVERY_MS = WINDOW_MS.day;
/** Peaks scan up to a month of rows; they are for choosing limits, not for
 *  watching, so a minute-old figure is as good as a fresh one. */
const PEAKS_TTL_MS = 60_000;

interface ICounter {
  limits: IAgentLimits | null;
  /** Timestamps of accepted visitor requests; empty while limits are off. */
  log: number[];
  /** Counts not yet written, by start of minute. */
  pending: Map<number, IAgentLoadMinute>;
  lastRefusedAt: number | null;
  /**
   * Until when the fullness that was last announced lasts; 0 when nothing is
   * announced. A time, not a flag: a window that freed by itself while nobody
   * was sending must be announced again the next time it fills.
   */
  announcedUntil: number;
}

const emptyMinute = (minute: number): IAgentLoadMinute => ({
  minute,
  accepted: 0,
  refused: 0,
  refusedByMinute: 0,
  refusedByHour: 0,
  refusedByDay: 0,
  exempt: 0,
});

const REFUSED_BY: Record<
  LimitWindow,
  'refusedByMinute' | 'refusedByHour' | 'refusedByDay'
> = {
  minute: 'refusedByMinute',
  hour: 'refusedByHour',
  day: 'refusedByDay',
};

function addInto(target: IAgentLoadMinute, from: IAgentLoadMinute): void {
  target.accepted += from.accepted;
  target.refused += from.refused;
  target.refusedByMinute += from.refusedByMinute;
  target.refusedByHour += from.refusedByHour;
  target.refusedByDay += from.refusedByDay;
  target.exempt += from.exempt;
}

/** Stored rows and unwritten counts as one list, oldest first. */
function merged(
  rows: IAgentLoadMinute[],
  pending: Iterable<IAgentLoadMinute>,
): IAgentLoadMinute[] {
  const byMinute = new Map<number, IAgentLoadMinute>();
  for (const r of rows) byMinute.set(r.minute, { ...r });
  for (const p of pending) {
    const have = byMinute.get(p.minute);
    if (have) addInto(have, p);
    else byMinute.set(p.minute, { ...p });
  }
  return [...byMinute.values()].sort((a, b) => a.minute - b.minute);
}

/** Highest total of accepted requests in any `windowMs`, at minute precision. */
function rollingPeak(rows: IAgentLoadMinute[], windowMs: number): number {
  let peak = 0;
  let sum = 0;
  let from = 0;
  for (let to = 0; to < rows.length; to++) {
    sum += rows[to].accepted;
    while (rows[from].minute <= rows[to].minute - windowMs) {
      sum -= rows[from].accepted;
      from++;
    }
    if (sum > peak) peak = sum;
  }
  return peak;
}

/**
 * The limiter (CLEAN-224): decides whether one more request may reach an
 * agent, and keeps the figures the operator watches.
 *
 * One allowance per agent, shared by everyone who talks to it — nobody has to
 * be identified to be counted. Counting is in this process's memory, which is
 * right only because the API runs as one copy (CLEAN-140); with a second copy
 * each would grant the full allowance, so it says so in the log and in the
 * snapshot instead of pretending.
 */
@Injectable()
export class AgentLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentLimitService.name);
  private readonly counters = new Map<string, ICounter>();
  private readonly peaks = new Map<
    string,
    { at: number; value: Record<LimitWindow, number> }
  >();
  private hub: IAgentLimitHub | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly gateway: IAgentLimitGateway,
    @Optional() private readonly instances?: ApiInstanceService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const now = Date.now();
      for (const row of await this.gateway.findAll()) {
        const counter = this.counterFor(row.agentId);
        counter.limits = row.limits;
        await this.rebuild(row.agentId, counter, now);
      }
      await this.gateway.pruneBefore(now - RETENTION_MS);
    } catch (err) {
      // Booting without counters is better than not booting: limits are then
      // empty-handed until the next change, and the log says why.
      this.logger.error(
        `Could not load request limits at boot: ${(err as Error).message}`,
      );
    }
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
    this.flushTimer.unref?.();
    this.pruneTimer = setInterval(() => {
      void this.gateway
        .pruneBefore(Date.now() - RETENTION_MS)
        .catch((err: Error) =>
          this.logger.warn(`Pruning load rows failed: ${err.message}`),
        );
    }, PRUNE_EVERY_MS);
    this.pruneTimer.unref?.();
    void this.warnIfSeveralCopies();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.flushTimer = null;
    this.pruneTimer = null;
    await this.flush();
  }

  /** The hub hands itself over at construction, so neither module imports the other. */
  attachHub(hub: IAgentLimitHub): void {
    this.hub = hub;
  }

  /**
   * May this request reach the agent? Records the outcome either way.
   *
   * Called at the one point every relayed request passes, after the hub has
   * ruled out a repeat of an accepted message and an offline agent — neither
   * of those is a request the agent takes, so neither is counted.
   */
  check(
    agentId: string,
    source: RequestSource = 'visitor',
    now: number = Date.now(),
  ): LimitDecision {
    const counter = this.counterFor(agentId);
    if (source !== 'visitor') {
      this.bump(counter, now).exempt += 1;
      return { admitted: true };
    }
    if (!counter.limits) {
      this.bump(counter, now).accepted += 1;
      return { admitted: true };
    }

    trim(counter.log, counter.limits, now);
    const decision = decide(counter.log, counter.limits, now);
    if (!decision.admitted) {
      const minute = this.bump(counter, now);
      minute.refused += 1;
      minute[REFUSED_BY[decision.window]] += 1;
      counter.lastRefusedAt = now;
      return decision;
    }

    admit(counter.log, now);
    this.bump(counter, now).accepted += 1;

    // The request that fills an hour or day window is the moment open chats
    // learn they will have to wait — before anyone types into a refusal.
    const state = this.stateOf(counter, now);
    if (!state.limited) {
      counter.announcedUntil = 0;
    } else if (now >= counter.announcedUntil) {
      counter.announcedUntil = now + state.retryAfterMs;
      this.hub?.broadcast(agentId, state);
    }
    return decision;
  }

  /** What a chat that opens now should be told. Never mentions the minute window. */
  stateFor(agentId: string, now: number = Date.now()): AgentLimitState {
    const counter = this.counters.get(agentId);
    return counter ? this.stateOf(counter, now) : { limited: false };
  }

  getLimits(agentId: string): IAgentLimits | null {
    return this.counters.get(agentId)?.limits ?? null;
  }

  /**
   * Set or remove an agent's limits. Takes effect for the next request and
   * keeps what was used so far: the log is rebuilt from the stored minutes,
   * so switching limits on for a busy agent starts from its real usage.
   *
   * The caller has already validated `limits` (agentLimit.rules).
   */
  async setLimits(
    agentId: string,
    limits: IAgentLimits | null,
    userId: string | null,
    now: number = Date.now(),
  ): Promise<void> {
    const next = hasAnyLimit(limits) ? limits : null;
    if (next) await this.gateway.upsert(agentId, next, userId);
    else await this.gateway.remove(agentId);

    const counter = this.counterFor(agentId);
    counter.limits = next;
    await this.rebuild(agentId, counter, now);

    const state = this.stateOf(counter, now);
    if (state.limited) {
      counter.announcedUntil = now + state.retryAfterMs;
      this.hub?.broadcast(agentId, state);
      return;
    }
    counter.announcedUntil = 0;
    // Room was made: chats that are counting down may stop. Not when the
    // minute window is still full — their next send would only be refused.
    if (decide(counter.log, counter.limits, now).admitted) {
      this.hub?.broadcast(agentId, { limited: false });
    }
  }

  /**
   * Room left in the tightest window, for a caller that paces itself. Null
   * when the agent has no limits.
   */
  remainingFor(
    agentId: string,
    now: number = Date.now(),
  ): { remaining: number; resetSec: number } | null {
    const counter = this.counters.get(agentId);
    if (!counter?.limits) return null;
    let tightest: { remaining: number; resetSec: number } | null = null;
    for (const w of LIMIT_WINDOWS) {
      const limit = limitFor(counter.limits, w);
      if (limit === null) continue;
      const used = countIn(counter.log, now, WINDOW_MS[w]);
      const remaining = Math.max(0, limit - used);
      // When the oldest request in the window leaves, room grows.
      const oldest = counter.log[counter.log.length - used];
      const resetSec =
        used > 0 ? Math.ceil((oldest + WINDOW_MS[w] - now) / 1000) : 0;
      if (!tightest || remaining < tightest.remaining) {
        tightest = { remaining, resetSec };
      }
    }
    return tightest;
  }

  /** One line per agent for list marks. */
  summary(
    agents: ReadonlyArray<{ id: string; isPublic: boolean }>,
    now: number = Date.now(),
  ): IAgentLimitSummary[] {
    return agents.map((agent) => {
      const counter = this.counters.get(agent.id);
      const limits = counter?.limits ?? null;
      return {
        agentId: agent.id,
        enabled: limits !== null,
        atLimit:
          !!counter && !!limits && !decide(counter.log, limits, now).admitted,
        needsLimits: agent.isPublic && limits === null,
      };
    });
  }

  /** The whole live picture of one agent, for the operator. */
  async snapshot(
    agent: { id: string; isPublic: boolean },
    now: number = Date.now(),
  ): Promise<IAgentLoadSnapshot> {
    const counter = this.counterFor(agent.id);
    const limits = counter.limits;
    const day = merged(
      await this.gateway.minutes(agent.id, now - WINDOW_MS.day - MINUTE_MS),
      counter.pending.values(),
    );

    const windows: IAgentLoadWindow[] = LIMIT_WINDOWS.map((w) => {
      const limit = limitFor(limits, w);
      if (limit === null) {
        // No log is kept for a window without a limit; the per-minute rows
        // are close enough for a figure with no ceiling to compare against.
        const since = now - WINDOW_MS[w];
        const used = day
          .filter((m) => m.minute + MINUTE_MS > since)
          .reduce((sum, m) => sum + m.accepted, 0);
        return { window: w, used, limit, retryAfterSec: null };
      }
      const used = countIn(counter.log, now, WINDOW_MS[w]);
      const full = decide(counter.log, limits, now, [w]);
      return {
        window: w,
        used,
        limit,
        retryAfterSec: full.admitted
          ? null
          : Math.ceil(full.retryAfterMs / 1000),
      };
    });

    const thisMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    const byMinute = new Map(day.map((m) => [m.minute, m]));
    const series: IAgentLoadMinute[] = [];
    for (let i = 59; i >= 0; i--) {
      const minute = thisMinute - i * MINUTE_MS;
      series.push(byMinute.get(minute) ?? emptyMinute(minute));
    }

    const refusedMinutes = day.filter((m) => m.refused > 0);
    const lastRefusedMinute = refusedMinutes[refusedMinutes.length - 1];
    const lastAt =
      counter.lastRefusedAt ??
      (lastRefusedMinute ? lastRefusedMinute.minute : null);

    return {
      limits,
      isPublic: agent.isPublic,
      needsLimits: agent.isPublic && limits === null,
      windows,
      inFlight: this.hub?.inFlight(agent.id) ?? 0,
      series,
      refused: {
        lastHour: series.reduce((sum, m) => sum + m.refused, 0),
        lastAt: lastAt === null ? null : new Date(lastAt).toISOString(),
        byWindow: {
          minute: series.reduce((sum, m) => sum + m.refusedByMinute, 0),
          hour: series.reduce((sum, m) => sum + m.refusedByHour, 0),
          day: series.reduce((sum, m) => sum + m.refusedByDay, 0),
        },
      },
      exemptLastHour: series.reduce((sum, m) => sum + m.exempt, 0),
      peaks: await this.peaksFor(agent.id, counter, now),
      apiReplicas: await this.replicas(),
    };
  }

  /** Write what has been counted since the last flush. Safe to call at any time. */
  async flush(): Promise<void> {
    // One flush at a time: the timer and a caller must not write the same
    // counts twice.
    if (this.flushing) await this.flushing;
    this.flushing = this.flushOnce().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  private async flushOnce(): Promise<void> {
    for (const [agentId, counter] of this.counters) {
      if (counter.pending.size === 0) continue;
      const batch = [...counter.pending.values()];
      counter.pending = new Map();
      try {
        await this.gateway.addMinutes(agentId, batch);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2003') {
          // The agent is gone; its rows went with it and so do its counts.
          this.counters.delete(agentId);
          this.peaks.delete(agentId);
          continue;
        }
        // Keep the counts for the next attempt, together with whatever was
        // counted while this one was failing.
        for (const lost of batch) {
          const have = counter.pending.get(lost.minute);
          if (have) addInto(have, lost);
          else counter.pending.set(lost.minute, lost);
        }
        this.logger.warn(
          `Could not store load counts for agent ${agentId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private counterFor(agentId: string): ICounter {
    let counter = this.counters.get(agentId);
    if (!counter) {
      counter = {
        limits: null,
        log: [],
        pending: new Map(),
        lastRefusedAt: null,
        announcedUntil: 0,
      };
      this.counters.set(agentId, counter);
    }
    return counter;
  }

  private bump(counter: ICounter, now: number): IAgentLoadMinute {
    const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    let bucket = counter.pending.get(minute);
    if (!bucket) {
      bucket = emptyMinute(minute);
      counter.pending.set(minute, bucket);
    }
    return bucket;
  }

  private stateOf(counter: ICounter, now: number): AgentLimitState {
    if (!counter.limits) return { limited: false };
    const d = decide(counter.log, counter.limits, now, ['hour', 'day']);
    if (d.admitted || d.window === 'minute') return { limited: false };
    return { limited: true, retryAfterMs: d.retryAfterMs, window: d.window };
  }

  private async rebuild(
    agentId: string,
    counter: ICounter,
    now: number,
  ): Promise<void> {
    if (!counter.limits) {
      counter.log = [];
      return;
    }
    const longest = Math.max(
      ...LIMIT_WINDOWS.filter((w) => limitFor(counter.limits, w) !== null).map(
        (w) => WINDOW_MS[w],
      ),
    );
    const stored = await this.gateway.minutes(
      agentId,
      now - longest - MINUTE_MS,
    );
    counter.log = rebuild(
      merged(stored, counter.pending.values()),
      counter.limits,
      now,
    );
  }

  private async peaksFor(
    agentId: string,
    counter: ICounter,
    now: number,
  ): Promise<Record<LimitWindow, number>> {
    const cached = this.peaks.get(agentId);
    if (cached && now - cached.at < PEAKS_TTL_MS) return cached.value;
    const rows = merged(
      await this.gateway.minutes(agentId, now - RETENTION_MS),
      counter.pending.values(),
    );
    const value: Record<LimitWindow, number> = {
      minute: rows.reduce((max, m) => Math.max(max, m.accepted), 0),
      hour: rollingPeak(rows, WINDOW_MS.hour),
      day: rollingPeak(rows, WINDOW_MS.day),
    };
    this.peaks.set(agentId, { at: now, value });
    return value;
  }

  private async replicas(): Promise<number> {
    if (!this.instances) return 1;
    try {
      return Math.max(1, await this.instances.liveCount());
    } catch {
      return 1;
    }
  }

  private async warnIfSeveralCopies(): Promise<void> {
    const copies = await this.replicas();
    if (copies > 1) {
      this.logger.warn(
        `${copies} copies of the API are live. Request limits are counted per copy, so each agent's real allowance is up to ${copies} times what is configured.`,
      );
    }
  }
}
