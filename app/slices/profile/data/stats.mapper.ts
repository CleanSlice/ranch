import type {
  InstallationStatsAgentDto,
  InstallationStatsDto,
  InstallationStatsIncidentDto,
  InstallationStatsNoteDto,
  InstallationStatsQualityDto,
  MyStatsAgentDto,
  MyStatsDto,
  StatsNoteDto,
} from '#api/data/repositories/api/types.gen';
import type {
  IInstallationAgent,
  IInstallationIncident,
  IInstallationNote,
  IInstallationQuality,
  IInstallationStats,
  IPersonalStats,
  IStatsAgent,
  IStatsLanguage,
  IStatsNote,
  IStatsOpenQuestion,
  IStatsOpenQuestions,
  IStatsOutcome,
  IStatsResolved,
  IStatsSummaries,
  IStatsTopic,
  IStatsTopicQuestion,
  StatsOutcomeKind,
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

// What follows reads the blocks that came with conversation summaries
// (CLEAN-270) off the answer as it arrives, whatever its type promises. An
// API that is older than the console sends none of them, and the page must
// then show "summaries off", which is what every absent piece maps to: a
// count of zero, an empty list, and `enabled: false`.

/** A count, or zero for anything that is not one: absent, negative, text. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * A count that is a part of `whole`, and so never more than it. An answer
 * that says 9 resolved of 6 summarised contradicts itself; the page prints
 * both numbers beside their share, and "9 of 6" is not a thing to print.
 */
function part(value: unknown, whole: number): number {
  return Math.min(count(value), whole);
}

/** Text as it came, or null when there is none. Never trimmed or re-cased. */
function words(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** An object to read fields off, or an empty one. */
function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A list, or an empty one. */
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const OUTCOMES: readonly StatsOutcomeKind[] = ['resolved', 'open', 'unknown'];

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
    const summaries = this.toSummaries(dto.summaries);
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
      summaries,
      board: {
        conversations: { ...dto.board.conversations },
        messages: { ...dto.board.messages },
        agents: { ...dto.board.agents },
        resolved: this.toResolved(dto.board.resolved),
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
      // No topic anywhere in the view while they are not ready (the owner's
      // decision of 2026-11-28): the API sends none then, and an older one,
      // which made a topic of whatever a conversation proposed, sends the
      // ones the decision holds back.
      topics: summaries.topicsReady ? this.toTopics(dto.topics) : [],
      outcome: this.toOutcome(dto.outcome),
      openQuestions: this.toOpenQuestions(dto.openQuestions, summaries.topicsReady),
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
      // Only an explicit `true`: an older API sends no field, and the open
      // share is then "not counted", never "none left open".
      summaries: { enabled: fields(dto.summaries).enabled === true },
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
      quality: dto.quality.map((row) => this.toQuality(row)),
      channels: dto.channels.map((row) => ({ ...row })),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private toSummaries(dto: unknown): IStatsSummaries {
    const from = fields(dto);
    // Only an explicit `true` switches the blocks on.
    const enabled = from.enabled === true;
    return {
      enabled,
      // And only an explicit `true` shows the Topics block: an older API
      // sends no field. Never without summaries, whatever the field says.
      topicsReady: enabled && from.topicsReady === true,
      summarised: count(from.summarised),
      waiting: count(from.waiting),
      tooShort: count(from.tooShort),
    };
  }

  private toResolved(dto: unknown): IStatsResolved {
    const from = fields(dto);
    const summarised = count(from.summarised);
    return { resolved: part(from.resolved, summarised), summarised };
  }

  /** A topic needs an id to be selected by and a label to be shown under. */
  private toTopics(dto: unknown): IStatsTopic[] {
    const topics: IStatsTopic[] = [];
    for (const entry of list(dto)) {
      const from = fields(entry);
      const id = words(from.id);
      const label = words(from.label);
      if (id === null || label === null) continue;
      topics.push({
        id,
        label,
        conversations: count(from.conversations),
        resolved: count(from.resolved),
        open: count(from.open),
        questions: this.toTopicQuestions(from.questions),
      });
    }
    return topics;
  }

  /** A question without words has nothing to show and is left out. */
  private toTopicQuestions(dto: unknown): IStatsTopicQuestion[] {
    const questions: IStatsTopicQuestion[] = [];
    for (const entry of list(dto)) {
      const from = fields(entry);
      const question = words(from.question);
      if (question === null) continue;
      const outcome = OUTCOMES.find((kind) => kind === from.outcome);
      questions.push({
        chatId: words(from.chatId) ?? '',
        agentId: words(from.agentId) ?? '',
        agentName: words(from.agentName) ?? '',
        question,
        at: instant(from.at),
        // An outcome this console does not know is no mark either way.
        outcome: outcome ?? 'unknown',
      });
    }
    return questions;
  }

  private toOutcome(dto: unknown): IStatsOutcome {
    const from = fields(dto);
    const tone = fields(from.sentiment);
    const languages: IStatsLanguage[] = [];
    for (const entry of list(from.languages)) {
      const language = fields(entry);
      const code = words(language.code);
      if (code !== null) languages.push({ code, conversations: count(language.conversations) });
    }
    return {
      resolved: count(from.resolved),
      open: count(from.open),
      unknown: count(from.unknown),
      notSummarised: count(from.notSummarised),
      sentiment: {
        positive: count(tone.positive),
        neutral: count(tone.neutral),
        mixed: count(tone.mixed),
        negative: count(tone.negative),
      },
      languages,
    };
  }

  /**
   * An open question is listed for its "Continue", which needs the agent and
   * the conversation. One that names neither is still an open conversation:
   * it goes to `more`, so that the list and the remainder keep adding up to
   * what the outcomes count as open.
   *
   * `withTopics` is `summaries.topicsReady`: without it a question carries
   * no topic, whatever the answer names for it.
   */
  private toOpenQuestions(dto: unknown, withTopics: boolean): IStatsOpenQuestions {
    const from = fields(dto);
    const items: IStatsOpenQuestion[] = [];
    let unlisted = 0;
    for (const entry of list(from.items)) {
      const item = fields(entry);
      const chatId = words(item.chatId);
      const agentId = words(item.agentId);
      if (chatId === null || agentId === null) {
        unlisted += 1;
        continue;
      }
      items.push({
        chatId,
        agentId,
        agentName: words(item.agentName) ?? '',
        // Null is "open, and no question was quoted": the page says so.
        question: words(item.question),
        topic: withTopics ? words(item.topic) : null,
        at: instant(item.at),
      });
    }
    return { items, more: count(from.more) + unlisted };
  }

  private toQuality(dto: InstallationStatsQualityDto): IInstallationQuality {
    const summarised = count(dto.summarised);
    return {
      agentId: dto.agentId,
      name: dto.name,
      conversations: dto.conversations,
      down: dto.down,
      rated: dto.rated,
      open: part(dto.open, summarised),
      summarised,
    };
  }

  // A note without a readable date has nothing to say ("counted since …"),
  // so it is left out rather than shown with an invented one.
  private toNote(dto: StatsNoteDto): IStatsNote | null {
    const completeSince = instant(dto.completeSince);
    return completeSince ? { figure: dto.figure, completeSince } : null;
  }

  private toAgent(dto: MyStatsAgentDto): IStatsAgent {
    const summarised = count(dto.summarised);
    return {
      agentId: dto.agentId,
      name: dto.name,
      messages: dto.messages,
      conversations: dto.conversations,
      resolved: part(dto.resolved, summarised),
      summarised,
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
