import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { ApiInstanceService } from '#/setting/domain/apiInstance.service';
import { IAgentGateway } from './agent.gateway';
import { detailOf, parseReport, reasonOf, summaryOf } from './toolState';
import {
  IAgentToolState,
  IAgentToolStateDetail,
  IToolAlert,
  ToolSummaryTypes,
} from './toolState.types';

const DEFAULT_ALERT_MS = 5 * 60_000;
export const TOOL_SWEEP_MS = 30_000;
/**
 * An agent that stays limited is reported again this often. The incident
 * closes after ten quiet minutes of 'running' (QUIET_MS), and an agent
 * without its tools is running the whole time: without a repeat the incident
 * would close as recovered over an agent that never got its tools back.
 */
export const TOOL_ALERT_REPEAT_MS = 5 * 60_000;

// An agent in one of these is not expected to have its tools: a person
// stopped it, or it is on its way up and the start-up status says so.
const NO_ALERT_STATUSES = new Set(['stopped', 'pending', 'deploying']);

/** How long an agent may stay `limited` before an incident opens (`TOOLS_LIMITED_ALERT_MS`). */
export function toolsLimitedAlertMs(): number {
  const value = Number(process.env.TOOLS_LIMITED_ALERT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ALERT_MS;
}

/** "Documents not connected for 5 min" — names and a duration, never an error. */
function limitedReason(state: IAgentToolState, forMs: number): string | null {
  const reason = reasonOf(state);
  if (!reason) return null;
  const minutes = Math.floor(forMs / 60_000);
  if (minutes < 1) return reason;
  const hours = Math.floor(minutes / 60);
  const span =
    hours < 1
      ? `${minutes} min`
      : minutes % 60 === 0
        ? `${hours} h`
        : `${hours} h ${minutes % 60} min`;
  return `${reason} for ${span}`;
}

interface IEntry {
  state: IAgentToolState;
  /** When this API first saw the agent limited; null while it is not. */
  limitedSince: number | null;
  /** When the last alert went out; null before the first. */
  alertedAt: number | null;
}

/**
 * The last tool-server report of every agent on the hub (CLEAN-245), in
 * memory: it describes a live socket and dies with it. Says the one word
 * anyone may read (`summary`), the record for the people who manage the
 * agent (`detail`), and tells the incident machinery when an agent has been
 * without its tools for too long.
 */
@Injectable()
export class AgentToolStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentToolStateService.name);
  private readonly entries = new Map<string, IEntry>();
  private readonly changes = new Subject<string>();
  private readonly alerts = new Subject<IToolAlert>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly agents: IAgentGateway,
    private readonly apiInstances: ApiInstanceService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep(Date.now()).catch((err) =>
        this.logger.warn(`Tool state sweep failed: ${(err as Error).message}`),
      );
    }, TOOL_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Takes a runtime's report. An invalid one is dropped with one log line
   * and changes nothing. Returns the agent's summary after the call.
   */
  accept(agentId: string, raw: unknown, now = Date.now()): ToolSummaryTypes {
    const state = parseReport(raw);
    if (!state) {
      this.logger.warn(`Dropped an invalid tool_state from agent ${agentId}`);
      return this.summary(agentId);
    }
    const previous = this.entries.get(agentId);
    const before = summaryOf(previous?.state ?? null);
    const after = summaryOf(state);
    const stillLimited = after === 'limited' && before === 'limited';
    this.entries.set(agentId, {
      state,
      limitedSince:
        after === 'limited'
          ? stillLimited
            ? (previous?.limitedSince ?? now)
            : now
          : null,
      alertedAt: stillLimited ? (previous?.alertedAt ?? null) : null,
    });
    if (before === 'limited' && after !== 'limited' && previous?.alertedAt) {
      this.alerts.next({
        kind: 'recovered',
        agentId,
        reason: null,
        at: new Date(now),
      });
    }
    if (before !== after) this.changes.next(agentId);
    return after;
  }

  /**
   * The agent's socket went: what it said no longer describes anything. No
   * recovery is announced — an agent that left the hub did not get its tools
   * back, and its absence is the unreachable path's to report.
   */
  clear(agentId: string): void {
    const previous = this.entries.get(agentId);
    if (!previous) return;
    this.entries.delete(agentId);
    if (summaryOf(previous.state) !== null) this.changes.next(agentId);
  }

  summary(agentId: string): ToolSummaryTypes {
    return summaryOf(this.entries.get(agentId)?.state ?? null);
  }

  detail(agentId: string): IAgentToolStateDetail | null {
    return detailOf(this.entries.get(agentId)?.state ?? null);
  }

  /** Ids of agents whose summary just changed. */
  changes$(): Observable<string> {
    return this.changes.asObservable();
  }

  alerts$(): Observable<IToolAlert> {
    return this.alerts.asObservable();
  }

  /**
   * Announces every agent that has been limited for longer than the
   * threshold, and again every `TOOL_ALERT_REPEAT_MS` while it stays so.
   * Returns how many alerts went out.
   */
  async sweep(now: number): Promise<number> {
    const threshold = toolsLimitedAlertMs();
    const due = [...this.entries].filter(
      ([, entry]) =>
        entry.limitedSince !== null &&
        now - entry.limitedSince >= threshold &&
        (entry.alertedAt === null ||
          now - entry.alertedAt >= TOOL_ALERT_REPEAT_MS),
    );
    if (due.length === 0) return 0;
    // The hub is per process: with a second copy alive this one sees only
    // some agents' reports, and a silence here is not a recovery there. The
    // same rule as 'unreachable' (CLEAN-140).
    if ((await this.apiInstances.liveCount()) > 1) return 0;

    let sent = 0;
    for (const [agentId, entry] of due) {
      const agent = await this.agents.findById(agentId).catch(() => null);
      if (!agent || NO_ALERT_STATUSES.has(agent.status)) continue;
      // Looked up, so time passed: the report may have been replaced.
      if (this.entries.get(agentId) !== entry) continue;
      entry.alertedAt = now;
      this.alerts.next({
        kind: 'limited',
        agentId,
        reason: limitedReason(entry.state, now - (entry.limitedSince ?? now)),
        at: new Date(now),
      });
      sent += 1;
    }
    return sent;
  }
}
