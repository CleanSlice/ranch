import type { StatsPeriod } from '../utils/statsView';

// The personal period view (CLEAN-258): what `GET /me/stats` answers for one
// person and one period, as the profile's Statistics tab reads it. Counts,
// names and times, and since CLEAN-270 one thing that was written: the main
// question of a summarised conversation, as its summary worded it, shown to
// the person who asked it and to nobody else.
//
// Instants are `Date` here, parsed once in the mapper. A calendar day stays
// the `YYYY-MM-DD` string the API sent: it is a day in the viewer's zone, and
// reading it into a `Date` would apply this browser's zone a second time
// (see `utils/calendarGrid.ts`).

/**
 * The figures of a person's view, as the API names them: the ones whose
 * history can start inside the period, and since CLEAN-270 `outcomes` and
 * `topics`. Those two are read where the summaries are kept and have no
 * first record, so the API never sends a note for them and no block looks
 * for one: how much of a period they cover is said exactly, by `summaries`.
 */
export type StatsNoteFigure =
  | 'activity'
  | 'ratings'
  | 'citations'
  | 'handovers'
  | 'outcomes'
  | 'topics';

/** A figure and the same figure of the period before. */
export interface IStatsCompared {
  value: number;
  previous: number;
}

/** A figure that is not complete over the whole period, and since when it is. */
export interface IStatsNote {
  figure: StatsNoteFigure;
  completeSince: Date;
}

export interface IStatsRange {
  from: Date;
  /** The moment the view was computed: the period includes today so far. */
  to: Date;
  previousFrom: Date;
}

/**
 * Conversation summaries in this installation and in the period (CLEAN-270).
 *
 * `enabled` is the one thing the page branches on. With summaries off every
 * count that is read from them (here, on the scoreboard, per agent, the
 * outcomes) is zero because nothing was counted, and the lists are empty: a
 * zero says nothing, `enabled` does.
 *
 * `topicsReady` is the second switch, for the Topics block alone (the
 * owner's decision of 2026-11-28): outcomes, tone, languages and open
 * questions are shown wherever summaries are produced, and topics wait until
 * the installation has a vocabulary to choose from (CLEAN-278). Here too an
 * empty list says nothing: "no topic among this period's conversations" and
 * "no topic is asked for yet" are different pages.
 */
export interface IStatsSummaries {
  /** Whether the installation produces conversation summaries. */
  enabled: boolean;
  /**
   * Whether topics are there to show: summaries are produced and the
   * installation has a vocabulary. False from an API that does not say, and
   * always with `enabled` false. While it is false the view carries no
   * topic: `topics` is empty and no open question has one.
   */
  topicsReady: boolean;
  /** Conversations of the period that have a summary. */
  summarised: number;
  /** Without one yet, and will get one: not counted in topics or outcomes. */
  waiting: number;
  /** Without one, and too short to get one as they stand. Not a backlog. */
  tooShort: number;
}

/** A resolved share and what it is a share of. */
export interface IStatsResolved {
  resolved: number;
  /** Conversations with a summary. Zero is "no share to show", not 0%. */
  summarised: number;
}

export interface IStatsBoard {
  /** Conversations the person wrote in. */
  conversations: IStatsCompared;
  /** The person's own messages. */
  messages: IStatsCompared;
  /** Agents that answered, out of the agents the person reaches now. */
  agents: { value: number; reachable: number };
  /** Conversations the summaries call resolved, out of the summarised. */
  resolved: IStatsResolved;
}

export interface IStatsDay {
  /** `YYYY-MM-DD`, in the viewer's zone. */
  date: string;
  conversations: number;
}

export interface IStatsActivity {
  /** The last 91 days whatever the period, oldest first, ending today. */
  days: IStatsDay[];
  /** Seven counts within the period, Monday first. */
  weekdays: number[];
  activeDays: number;
}

export interface IStatsAgent {
  agentId: string;
  name: string;
  /** The person's own messages to this agent in the period. */
  messages: number;
  conversations: number;
  /** Of those conversations, the ones a summary calls resolved. */
  resolved: number;
  /** Of those conversations, the ones that have a summary. */
  summarised: number;
  /** As received. Null when the agent has none. */
  model: string | null;
  lastMessageAt: Date | null;
}

/**
 * How a summarised conversation ended. `unknown` is a real answer: the
 * summary could not tell. It is neither resolved nor an open question.
 */
export type StatsOutcomeKind = 'resolved' | 'open' | 'unknown';

/** A main question of one conversation under a topic. */
export interface IStatsTopicQuestion {
  chatId: string;
  agentId: string;
  /** As received. */
  agentName: string;
  /** The person's question as the summary worded it. Shown as received. */
  question: string;
  /** The conversation's last message. */
  at: Date | null;
  outcome: StatsOutcomeKind;
}

export interface IStatsTopic {
  id: string;
  /** In the language of the request, as the API chose it. Shown as received. */
  label: string;
  /** Summarised conversations of the period that carry the topic. */
  conversations: number;
  resolved: number;
  /** With `resolved` it can be less than `conversations`: the rest is unknown. */
  open: number;
  /** At most four, newest first. Empty when no summary quoted a question. */
  questions: IStatsTopicQuestion[];
}

/** The tones a summary can give a conversation. */
export const STATS_TONES = ['positive', 'neutral', 'mixed', 'negative'] as const;
export type StatsTone = (typeof STATS_TONES)[number];

export interface IStatsLanguage {
  /** ISO 639-1, as the summary judged it. */
  code: string;
  /** Summarised conversations in that language. */
  conversations: number;
}

/**
 * How the period's conversations ended. The four counts are parts of the
 * period's conversations and add up to them while summaries are on.
 */
export interface IStatsOutcome {
  resolved: number;
  open: number;
  /** Summarised, and the summary could not tell. */
  unknown: number;
  /** No summary: waiting for one, or too short for one. */
  notSummarised: number;
  /** Among the summarised; can add up to less than them. */
  sentiment: Record<StatsTone, number>;
  /** Among the summarised, most first. */
  languages: IStatsLanguage[];
}

/** A conversation the summaries call left open. */
export interface IStatsOpenQuestion {
  /** With `agentId`, what "Continue" opens. */
  chatId: string;
  agentId: string;
  /** As received. */
  agentName: string;
  /** Shown as received. Null when the summary quoted no question. */
  question: string | null;
  /**
   * The label of the conversation's first topic, as received. Null when
   * none, and for every question while `summaries.topicsReady` is false.
   */
  topic: string | null;
  /** The conversation's last message. */
  at: Date | null;
}

export interface IStatsOpenQuestions {
  /** The newest four, newest first. */
  items: IStatsOpenQuestion[];
  /** How many more the period has: with `items` it is `outcome.open`. */
  more: number;
}

/**
 * The name the API gives every web page together. The page shows it through a
 * key; a knowledge base's name is shown as received.
 */
export const WEB_SOURCE = 'web';

export interface IStatsSource {
  name: string;
  citations: number;
}

export interface IStatsHelp {
  cited: {
    /** Conversations with at least one answer with sources. */
    conversations: number;
    /** At most two, most cited first. */
    sources: IStatsSource[];
  };
  handovers: {
    total: number;
    answered: number;
    topPeer: { name: string; count: number } | null;
  };
  ratings: { up: number; down: number };
}

/**
 * The name the API gives messages it could attribute to no model. Shown
 * through a key; every other model name is shown as received.
 */
export const UNKNOWN_MODEL = 'unknown';

export interface IStatsModel {
  model: string;
  /** The person's messages attributed to it. */
  messages: number;
}

export interface IStatsModels {
  /** By messages, most first. */
  items: IStatsModel[];
  /** Some days had no record of the model in use: the agent's current one stood in. */
  fallback: boolean;
}

export interface IPersonalStats {
  period: StatsPeriod;
  /** The zone the days were cut in. */
  timeZone: string;
  range: IStatsRange;
  notes: IStatsNote[];
  summaries: IStatsSummaries;
  board: IStatsBoard;
  activity: IStatsActivity;
  /** By the person's messages, most first. */
  agents: IStatsAgent[];
  /** At most eight, most conversations first. Empty with summaries off. */
  topics: IStatsTopic[];
  outcome: IStatsOutcome;
  openQuestions: IStatsOpenQuestions;
  help: IStatsHelp;
  models: IStatsModels;
}

/**
 * The setting that schedules the summary batch, by the name an operator
 * finds it under. Named once: the "summaries off" card and the line under
 * the installation's quality table both read it from here.
 */
export const SUMMARY_INTERVAL_VARIABLE = 'CHAT_INSIGHT_INTERVAL_SEC';

// The installation period view (CLEAN-265): what `GET /stats/installation`
// answers for the agents the viewer reaches and one period. Counts, sums,
// names of agents and models, incidents and times: no person's name, no
// identity, nothing that was written.
//
// Its days are UTC days for every viewer, the boundary spend is reported on,
// and stay the `YYYY-MM-DD` strings the API sent, like the personal view's.

/** The installation figures whose history can start inside the period. */
export type InstallationNoteFigure = 'activity' | 'refusals';

export interface IInstallationNote {
  figure: InstallationNoteFigure;
  completeSince: Date;
}

export interface IInstallationReach {
  /** Some agent is hidden from the viewer: every figure is of a part. */
  limited: boolean;
  /** Agents the viewer reaches now. */
  agents: number;
  /**
   * Names of the agents the viewer reaches whose conversations are the
   * Owner's alone to read, as received. Those conversations are left out of
   * the people count, the quality block and the channels block; the agents'
   * spend and health are in the view like any other's. Empty for the Owner.
   */
  ownerOnly: string[];
}

export interface IInstallationCost extends IStatsCompared {
  /**
   * Models used in the period that the price list does not have, most tokens
   * first. Their cost is in no sum: "no price", never free.
   */
  unpriced: string[];
}

export interface IInstallationBoard {
  tokens: { input: number; output: number };
  /** Model calls. */
  calls: IStatsCompared;
  /** USD from the product's own price list: an estimate, not an invoice. */
  cost: IInstallationCost;
  /** Distinct people who wrote in a conversation. */
  people: IStatsCompared;
}

export interface IInstallationDayModel {
  /** As received. */
  model: string;
  /** Input and output together. */
  tokens: number;
}

export interface IInstallationDay {
  /** `YYYY-MM-DD`, a UTC day. */
  date: string;
  /** USD of the day's priced models; 0 for a day of unpriced models alone. */
  cost: number;
  /** Most tokens first. Empty for a day nobody reported usage for. */
  byModel: IInstallationDayModel[];
}

export interface IInstallationModel {
  model: string;
  /** Whether the price list has it. */
  priced: boolean;
}

export interface IInstallationAgent {
  agentId: string;
  /** The name it has now, or the one its usage was last reported under. */
  name: string;
  /** The agent no longer exists; what it spent stays in its period. */
  removed: boolean;
  /** The model that took most of its tokens. As received. */
  model: string;
  tokens: number;
  calls: number;
  /** Null when none of its models has a price: "no price", not zero. */
  cost: number | null;
  /**
   * The agent also ran a model with no price, so `cost` is of its priced
   * models only. False for a fully priced agent and for one with no cost.
   */
  partial: boolean;
}

export interface IInstallationIncident {
  /** The short handle people use: "#12". */
  number: number;
  /** The agent's name when the incident opened. */
  agentName: string;
  open: boolean;
  /** In the sender's words, shown as received. Null when none was given. */
  reason: string | null;
  openedAt: Date | null;
  /** Null while the incident is open. */
  closedAt: Date | null;
}

export interface IInstallationRefusals {
  agentId: string;
  name: string;
  /** Requests its limits refused in the period. Above zero. */
  refused: number;
}

export interface IInstallationHealth {
  /** Newest first; at most what the API lists. */
  incidents: IInstallationIncident[];
  /** How many the period has, the ones not listed included. */
  incidentsTotal: number;
  /** Most refusals first. */
  refusals: IInstallationRefusals[];
}

/**
 * How one agent's conversations went. The share left open is `open` out of
 * `summarised`; both are zero when the installation produces no summaries
 * (`IInstallationStats.summaries.enabled`), which is "not counted" and not
 * "none left open".
 */
export interface IInstallationQuality {
  agentId: string;
  name: string;
  conversations: number;
  /** Ratings that were down, out of `rated`. */
  down: number;
  rated: number;
  /** Summarised conversations the summary calls left open. */
  open: number;
  /** Of `conversations`, the ones that have a summary. */
  summarised: number;
}

/** The channels the console words itself; any other is shown as received. */
export const INSTALLATION_CHANNELS = ['console', 'telegram', 'slack', 'share', 'other'] as const;

export interface IInstallationChannel {
  /** One of `INSTALLATION_CHANNELS`, or whatever the API named. */
  channel: string;
  conversations: number;
}

export interface IInstallationStats {
  period: StatsPeriod;
  range: IStatsRange;
  reach: IInstallationReach;
  notes: IInstallationNote[];
  /** Whether summaries are produced: what the open share of `quality` is read from. */
  summaries: { enabled: boolean };
  board: IInstallationBoard;
  /** One entry per UTC day of the period, oldest first, today last. */
  daily: IInstallationDay[];
  /** Every model used in the period, most tokens first: the chart's legend. */
  models: IInstallationModel[];
  /** By cost, most first; agents with no price after them, by tokens. */
  agents: IInstallationAgent[];
  /**
   * USD for 30 days at the pace of the period's finished days, today left
   * out. Null while no finished day has usage: no projection, not zero.
   */
  projection30d: number | null;
  health: IInstallationHealth;
  /** Most conversations first; the table orders them (`utils/qualityRows.ts`). */
  quality: IInstallationQuality[];
  /** Most conversations first; a channel nobody wrote on is absent. */
  channels: IInstallationChannel[];
}

/**
 * The route refused the caller (403): the installation's figures are for the
 * owner and administrators. Its own class because the page says something
 * else for it than for a request that failed, and offers no Retry.
 */
export class StatsForbiddenError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'StatsForbiddenError';
  }
}
