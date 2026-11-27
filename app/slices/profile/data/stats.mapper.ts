import type {
  InstallationStatsAgentDto,
  InstallationStatsDto,
  InstallationStatsIncidentDto,
  InstallationStatsNoteDto,
  MyStatsAgentDto,
  MyStatsDto,
  StatsNoteDto,
} from '#api/data/repositories/api/types.gen';
import type {
  IInstallationAgent,
  IInstallationIncident,
  IInstallationNote,
  IInstallationStats,
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

/** A sum of money as a number, or null when none arrived: never a zero. */
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A list of names, copied; anything else (absent, not a list, a list with
 * something that is not a string in it) is no names rather than half a list.
 */
function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const name: unknown = value[index];
    if (typeof name !== 'string') return [];
    out.push(name);
  }
  return out;
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

  /**
   * The installation view. Its days (`daily[].date`) are UTC days and stay
   * strings, like the personal view's. Every list is copied, so the view in
   * the store shares nothing with the answer it was made from.
   */
  toInstallation(dto: InstallationStatsDto): IInstallationStats {
    return {
      period: dto.period,
      range: {
        from: instant(dto.range.from) ?? new Date(NaN),
        to: instant(dto.range.to) ?? new Date(NaN),
        previousFrom: instant(dto.range.previousFrom) ?? new Date(NaN),
      },
      reach: {
        limited: dto.reach.limited === true,
        agents: dto.reach.agents,
        // Read through names(): an older API sends no field at all, and
        // anything that is not a list of names is an empty one.
        ownerOnly: names(dto.reach.ownerOnly),
      },
      notes: dto.notes
        .map((note) => this.toInstallationNote(note))
        .filter((note): note is IInstallationNote => note !== null),
      board: {
        tokens: { ...dto.board.tokens },
        calls: { ...dto.board.calls },
        cost: {
          value: dto.board.cost.value,
          previous: dto.board.cost.previous,
          unpriced: [...dto.board.cost.unpriced],
        },
        people: { ...dto.board.people },
      },
      daily: dto.daily.map((day) => ({
        date: day.date,
        cost: day.cost,
        byModel: day.byModel.map((part) => ({ ...part })),
      })),
      models: dto.models.map((model) => ({ model: model.model, priced: model.priced === true })),
      agents: dto.agents.map((agent) => this.toInstallationAgent(agent)),
      // Null is "no finished day with usage yet". Anything that is not a
      // number is no projection rather than a projection of nothing.
      projection30d: amount(dto.projection30d),
      health: {
        incidents: dto.health.incidents.map((incident) => this.toIncident(incident)),
        incidentsTotal: dto.health.incidentsTotal,
        refusals: dto.health.refusals.map((row) => ({ ...row })),
      },
      quality: dto.quality.map((row) => ({ ...row })),
      channels: dto.channels.map((row) => ({ ...row })),
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

  private toInstallationNote(dto: InstallationStatsNoteDto): IInstallationNote | null {
    const completeSince = instant(dto.completeSince);
    return completeSince ? { figure: dto.figure, completeSince } : null;
  }

  private toInstallationAgent(dto: InstallationStatsAgentDto): IInstallationAgent {
    return {
      agentId: dto.agentId,
      name: dto.name,
      removed: dto.removed === true,
      model: dto.model,
      tokens: dto.tokens,
      calls: dto.calls,
      // Only a number is a cost. Anything else is "no price": turning it
      // into 0 would show an agent as free that nobody could price.
      cost: amount(dto.cost),
      // Absent from an older API's answer: only an explicit `true` marks a
      // cost as partial.
      partial: dto.partial === true,
    };
  }

  private toIncident(dto: InstallationStatsIncidentDto): IInstallationIncident {
    return {
      number: dto.number,
      agentName: dto.agentName,
      open: dto.open === true,
      // The sender's words, untouched; an empty one is no reason at all.
      reason: typeof dto.reason === 'string' && dto.reason ? dto.reason : null,
      openedAt: instant(dto.openedAt),
      closedAt: instant(dto.closedAt),
    };
  }
}
