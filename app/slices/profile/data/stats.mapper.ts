import type {
  MyStatsAgentDto,
  MyStatsDto,
  StatsNoteDto,
} from '#api/data/repositories/api/types.gen';
import type {
  IPersonalStats,
  IStatsAgent,
  IStatsNote,
} from '../domain/stats.types';

/** An ISO instant as a `Date`, or null when it is absent or not a date. */
function instant(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Maps the generated statistics DTO onto the slice's domain shape. The one
 * place in the profile slice that imports from `#api`, and the one place an
 * instant is parsed: everything above it holds a `Date`.
 *
 * Calendar days (`activity.days[].date`) are left as the `YYYY-MM-DD` strings
 * they are: a day is not an instant (see `domain/stats.types.ts`).
 */
export class StatsMapper {
  toPersonal(dto: MyStatsDto): IPersonalStats {
    return {
      period: dto.period,
      timeZone: dto.timeZone,
      range: {
        // The range of an answered view is always there; an unreadable one
        // becomes an invalid date rather than a made-up moment.
        from: instant(dto.range.from) ?? new Date(NaN),
        to: instant(dto.range.to) ?? new Date(NaN),
        previousFrom: instant(dto.range.previousFrom) ?? new Date(NaN),
      },
      notes: dto.notes
        .map((note) => this.toNote(note))
        .filter((note): note is IStatsNote => note !== null),
      board: {
        conversations: { ...dto.board.conversations },
        messages: { ...dto.board.messages },
        agents: { ...dto.board.agents },
      },
      activity: {
        days: dto.activity.days.map((day) => ({
          date: day.date,
          conversations: day.conversations,
        })),
        weekdays: [...dto.activity.weekdays],
        activeDays: dto.activity.activeDays,
      },
      agents: dto.agents.map((agent) => this.toAgent(agent)),
      help: {
        cited: {
          conversations: dto.help.cited.conversations,
          sources: dto.help.cited.sources.map((source) => ({ ...source })),
        },
        handovers: {
          total: dto.help.handovers.total,
          answered: dto.help.handovers.answered,
          topPeer: dto.help.handovers.topPeer ? { ...dto.help.handovers.topPeer } : null,
        },
        ratings: { ...dto.help.ratings },
      },
      models: {
        items: dto.models.items.map((item) => ({ ...item })),
        fallback: dto.models.fallback === true,
      },
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  // A note without a readable date has nothing to say ("counted since …"),
  // so it is left out rather than shown with an invented one.
  private toNote(dto: StatsNoteDto): IStatsNote | null {
    const completeSince = instant(dto.completeSince);
    return completeSince ? { figure: dto.figure, completeSince } : null;
  }

  private toAgent(dto: MyStatsAgentDto): IStatsAgent {
    return {
      agentId: dto.agentId,
      name: dto.name,
      messages: dto.messages,
      conversations: dto.conversations,
      model: typeof dto.model === 'string' && dto.model ? dto.model : null,
      lastMessageAt: instant(dto.lastMessageAt),
    };
  }
}
