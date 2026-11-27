import type { IAccessCaller } from '#/user/agentAccess/domain/agentAccess.types';
import type { IFigureNote } from './figure.types';
import type { IModelAttribution } from './modelAttribution';
import type { IPeriodRange, Period } from './period';

// A person's own statistics for a period (CLEAN-258; spec 038,
// contracts/api.md, `GET /me/stats`). The shape the route and the tool
// `get_my_stats` both answer with. Counts, names of agents, models and
// sources, and times. Nothing a person wrote and nothing an agent answered.

/**
 * The figures a person's view is made of (`domain/figures/`). Each carries
 * a note when its history begins inside the period or the one before it.
 * "Which model answered" is not among them: it says for itself, with
 * `fallback`, where it had no record to go by.
 */
export const PERSONAL_FIGURES = [
  'activity',
  'ratings',
  'citations',
  'handovers',
] as const;

/**
 * Whose statistics. All three come from the proof of who is asking (the
 * console token, or the party a tool call is made for) and never from a
 * parameter: there is no way to ask for somebody else's (FR-020).
 *
 * One person has two names here, and they differ for the Owner. Their
 * conversations, and the citations and hand-overs made while answering
 * them, are kept under their chat identity (`admin` for the Owner, the
 * account id for everybody else). The ratings they give are kept under
 * their account id, the Owner's included.
 */
export interface IStatsViewer {
  /** The account id: the token's `sub`. */
  userId: string;
  /** The chat identity: what `clientIdFromJwtPayload` gives that token. */
  clientId: string;
  /** Who to ask the access lists as: the agents this person reaches now. */
  caller: IAccessCaller;
}

export interface IStatsQuestion {
  period: Period;
  /**
   * The viewer's IANA zone as it arrived, unchecked. Anything that is not a
   * zone this runtime knows is read as UTC, and the answer says which zone
   * was used.
   */
  timeZone?: unknown;
}

/** A number for the period and the same number for the period before it. */
export interface IComparedCount {
  value: number;
  previous: number;
}

export interface IPersonalBoard {
  /** Conversations the person wrote in. */
  conversations: IComparedCount;
  /** The person's own messages. */
  messages: IComparedCount;
  agents: {
    /** Agents that answered in the person's conversations in the period. */
    value: number;
    /** Agents the person reaches now. */
    reachable: number;
  };
}

export interface IActivityDay {
  /** `YYYY-MM-DD` in the viewer's zone. */
  date: string;
  /** Conversations the person wrote in on that day. */
  conversations: number;
}

export interface IPersonalActivity {
  /** `CALENDAR_DAYS` entries, oldest first, ending today. */
  days: IActivityDay[];
  /**
   * Conversations by weekday within the period, Monday first. A conversation
   * written in on two days counts on both, as it does in `days`.
   */
  weekdays: number[];
  /** Days of the period with at least one conversation. */
  activeDays: number;
}

export interface IPersonalAgent {
  agentId: string;
  name: string;
  /** The person's own messages to it in the period. */
  messages: number;
  /** Conversations with it the person wrote in during the period. */
  conversations: number;
  /** The model it runs now; null when it has none. */
  model: string | null;
  /** The last message of those conversations, whoever wrote it. */
  lastMessageAt: Date | null;
}

export interface IPersonalHelp {
  cited: {
    /** Conversations of the period that got an answer with sources. */
    conversations: number;
    /** The most cited, at most `TOP_SOURCES`: a base by name, or `web`. */
    sources: { name: string; citations: number }[];
  };
  handovers: {
    total: number;
    answered: number;
    /** The peer asked most; null when nothing was handed over. */
    topPeer: { name: string; count: number } | null;
  };
  /** The ratings the person gave in the period. */
  ratings: { up: number; down: number };
}

export interface IPersonalStats {
  period: Period;
  /** The zone the days were cut in. */
  timeZone: string;
  range: IPeriodRange;
  notes: IFigureNote[];
  board: IPersonalBoard;
  activity: IPersonalActivity;
  /** By messages, most first; equal ones by name. */
  agents: IPersonalAgent[];
  help: IPersonalHelp;
  models: IModelAttribution;
}
