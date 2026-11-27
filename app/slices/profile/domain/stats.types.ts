import type { StatsPeriod } from '../utils/statsView';

// The personal period view (CLEAN-258): what `GET /me/stats` answers for one
// person and one period, as the profile's Statistics tab reads it. Counts,
// names and times only: nothing that was written.
//
// Instants are `Date` here, parsed once in the mapper. A calendar day stays
// the `YYYY-MM-DD` string the API sent: it is a day in the viewer's zone, and
// reading it into a `Date` would apply this browser's zone a second time
// (see `utils/calendarGrid.ts`).

/** The figures whose history can start inside the period. */
export type StatsNoteFigure = 'activity' | 'ratings' | 'citations' | 'handovers';

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

export interface IStatsBoard {
  /** Conversations the person wrote in. */
  conversations: IStatsCompared;
  /** The person's own messages. */
  messages: IStatsCompared;
  /** Agents that answered, out of the agents the person reaches now. */
  agents: { value: number; reachable: number };
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
  /** As received. Null when the agent has none. */
  model: string | null;
  lastMessageAt: Date | null;
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
  board: IStatsBoard;
  activity: IStatsActivity;
  /** By the person's messages, most first. */
  agents: IStatsAgent[];
  help: IStatsHelp;
  models: IStatsModels;
}

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
 * How one agent's conversations went. The share left open is not here yet:
 * it is read from conversation summaries, which this view does not carry.
 */
export interface IInstallationQuality {
  agentId: string;
  name: string;
  conversations: number;
  /** Ratings that were down, out of `rated`. */
  down: number;
  rated: number;
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
  /** Most conversations first. */
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
