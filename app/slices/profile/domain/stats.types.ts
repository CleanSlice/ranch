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
