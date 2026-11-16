import type { SetAgentLimitsDto } from '#api/data/repositories/api/types.gen';
import type {
  IAgentLimitSummary,
  IAgentLimits,
  IAgentLoad,
  IAgentLoadByWindow,
  IAgentLoadMinute,
  IAgentLoadWindow,
  LimitWindowTypes,
} from '../domain/agentLimit.types';

const WINDOWS: readonly LimitWindowTypes[] = ['minute', 'hour', 'day'];

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Maps the request-limit routes onto domain shapes. Reads defensively, the way
 * `AgentMapper` does: a field the server did not send becomes zero or null, and
 * a row without an agent id is dropped rather than drawn.
 */
export class AgentLimitMapper {
  toSummaryList(raw: unknown): IAgentLimitSummary[] {
    if (!Array.isArray(raw)) return [];
    const out: IAgentLimitSummary[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const o = record(raw[i]);
      if (typeof o.agentId !== 'string' || !o.agentId) continue;
      out.push({
        agentId: o.agentId,
        enabled: o.enabled === true,
        atLimit: o.atLimit === true,
        needsLimits: o.needsLimits === true,
      });
    }
    return out;
  }

  /** `null` for anything that is not a limits object, and for one with no limit in it. */
  toLimits(raw: unknown): IAgentLimits | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const limits: IAgentLimits = {
      perMinute: countOrNull(o.perMinute),
      perHour: countOrNull(o.perHour),
      perDay: countOrNull(o.perDay),
    };
    if (
      limits.perMinute === null &&
      limits.perHour === null &&
      limits.perDay === null
    ) {
      return null;
    }
    return limits;
  }

  /** The `{ limits }` state both `GET` and `PUT /agents/:id/limits` answer. */
  toLimitsState(raw: unknown): IAgentLimits | null {
    return this.toLimits(record(raw).limits);
  }

  /** All three fields always travel: an absent one would mean "leave as is". */
  toSetDto(limits: IAgentLimits | null): SetAgentLimitsDto {
    return {
      perMinute: limits?.perMinute ?? null,
      perHour: limits?.perHour ?? null,
      perDay: limits?.perDay ?? null,
    };
  }

  toLoad(raw: unknown): IAgentLoad | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const refused = record(o.refused);
    return {
      limits: this.toLimits(o.limits),
      isPublic: o.isPublic === true,
      needsLimits: o.needsLimits === true,
      windows: this.toWindows(o.windows),
      inFlight: count(o.inFlight),
      series: this.toSeries(o.series),
      refused: {
        lastHour: count(refused.lastHour),
        lastAt: typeof refused.lastAt === 'string' ? refused.lastAt : null,
        byWindow: this.toByWindow(refused.byWindow),
      },
      exemptLastHour: count(o.exemptLastHour),
      peaks: this.toByWindow(o.peaks),
      apiReplicas: count(o.apiReplicas) || 1,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Always minute, hour, day in that order, whatever order the server used. */
  private toWindows(raw: unknown): IAgentLoadWindow[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: IAgentLoadWindow[] = [];
    for (let w = 0; w < WINDOWS.length; w += 1) {
      const name = WINDOWS[w]!;
      let found: Record<string, unknown> = {};
      for (let i = 0; i < list.length; i += 1) {
        const item = record(list[i]);
        if (item.window === name) {
          found = item;
          break;
        }
      }
      out.push({
        window: name,
        used: count(found.used),
        limit: countOrNull(found.limit),
        retryAfterSec: countOrNull(found.retryAfterSec),
      });
    }
    return out;
  }

  private toSeries(raw: unknown): IAgentLoadMinute[] {
    if (!Array.isArray(raw)) return [];
    const out: IAgentLoadMinute[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const o = record(raw[i]);
      if (typeof o.minute !== 'string') continue;
      out.push({
        minute: o.minute,
        accepted: count(o.accepted),
        refused: count(o.refused),
        exempt: count(o.exempt),
      });
    }
    return out;
  }

  private toByWindow(raw: unknown): IAgentLoadByWindow {
    const o = record(raw);
    return { minute: count(o.minute), hour: count(o.hour), day: count(o.day) };
  }
}
