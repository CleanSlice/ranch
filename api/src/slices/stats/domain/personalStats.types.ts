import type { ChatOutcome } from '#/chat/domain/chat.types';
import type { IAccessCaller } from '#/user/agentAccess/domain/agentAccess.types';
import type { IFigureNote } from './figure.types';
import type { IModelAttribution } from './modelAttribution';
import type { IPeriodRange, Period } from './period';

// A person's own statistics for a period (CLEAN-258; spec 038,
// contracts/api.md, `GET /me/stats`). The shape the route and the tool
// `get_my_stats` both answer with. Counts, names of agents, models, sources
// and topics, and times. Nothing an agent answered, and of what the person
// wrote one thing only: the main question of a conversation, as its summary
// worded it, which is theirs and is shown to them alone (FR-033).

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
  'outcomes',
  'topics',
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
  /**
   * The console language topics are named in: one of the languages a topic
   * has a label in, as `topicLanguageOf` reads it from `Accept-Language`.
   * English when it is not given, which is the case for a tool call: it has
   * no such header.
   */
  language?: string;
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
  /** The resolved share and what it is a share of. Both 0 without summaries. */
  resolved: IPersonalResolved;
}

/**
 * Whether the installation produces conversation summaries, and where the
 * period's conversations stand with them. The three counts add up to
 * `board.conversations.value`; all three are 0 when `enabled` is false,
 * where nothing about summaries is computed.
 */
export interface IPersonalSummaries {
  /** False: no summaries are produced, and the blocks read from them are empty. */
  enabled: boolean;
  /**
   * Whether the topics are there to show (CLEAN-270, the owner's decision of
   * 2026-11-28): summaries are produced and the installation has a
   * vocabulary, at least one topic that stands. While it has none, the
   * summary asks no conversation about topics (`ChatInsightService`), so
   * `topics` is empty and every open question's `topic` is null, and the
   * page leaves the topics block out instead of drawing it empty. Everything
   * else read from summaries is counted either way. How a vocabulary comes
   * to exist is CLEAN-278.
   */
  topicsReady: boolean;
  /** Conversations of the period that have a summary. */
  summarised: number;
  /** Without one yet, and long enough to get one. */
  waiting: number;
  /** Without one, and under the messages a summary is made with. */
  tooShort: number;
}

export interface IPersonalResolved {
  /** Conversations of the period whose summary says the person got their answer. */
  resolved: number;
  /** Conversations of the period that have a summary: what the share is of. */
  summarised: number;
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
  /** The ones among them whose summary says resolved. 0 without summaries. */
  resolved: number;
  /** The ones among them that have a summary. 0 without summaries. */
  summarised: number;
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

/** One main question of the person's, under a topic. */
export interface IPersonalTopicQuestion {
  /** The conversation it was asked in: what "open it" opens. */
  chatId: string;
  agentId: string;
  agentName: string;
  /** One line, the person's language, as the summary worded it. */
  question: string;
  /** The conversation's last message. */
  at: Date;
  /** `unknown` when the summary could not tell. */
  outcome: ChatOutcome;
}

export interface IPersonalTopic {
  /** The topic that stands: a merged one is counted under its target. */
  id: string;
  /** In the language asked for; English, then the key, when it has none. */
  label: string;
  /** Summarised conversations of the period that carry it. */
  conversations: number;
  /** Of them, resolved and open. `unknown` is in neither. */
  resolved: number;
  open: number;
  /** At most `TOPIC_QUESTIONS_SHOWN`, each wording once, newest first. */
  questions: IPersonalTopicQuestion[];
}

export interface IPersonalOutcome {
  /** The four add up to `board.conversations.value`. */
  resolved: number;
  open: number;
  /** Summarised, and the summary could not tell. */
  unknown: number;
  notSummarised: number;
  /** Among the summarised; a summary with no tone stored is in none. */
  sentiment: {
    positive: number;
    neutral: number;
    mixed: number;
    negative: number;
  };
  /** Among the summarised, most first. */
  languages: { code: string; conversations: number }[];
}

export interface IPersonalOpenQuestion {
  chatId: string;
  agentId: string;
  agentName: string;
  /** Null when the summary found no question to quote. */
  question: string | null;
  /**
   * The label of the conversation's first topic; null when it has none,
   * and for every question while `summaries.topicsReady` is false.
   */
  topic: string | null;
  /** The conversation's last message. */
  at: Date;
}

export interface IPersonalOpenQuestions {
  /** At most `OPEN_QUESTIONS_SHOWN`, newest first. */
  items: IPersonalOpenQuestion[];
  /** How many more there are: with `items`, the open part of `outcome`. */
  more: number;
}

export interface IPersonalStats {
  period: Period;
  /** The zone the days were cut in. */
  timeZone: string;
  range: IPeriodRange;
  notes: IFigureNote[];
  summaries: IPersonalSummaries;
  board: IPersonalBoard;
  activity: IPersonalActivity;
  /** By messages, most first; equal ones by name. */
  agents: IPersonalAgent[];
  /**
   * At most `TOPICS_SHOWN`, most conversations first. Empty without
   * summaries, and while `summaries.topicsReady` is false.
   */
  topics: IPersonalTopic[];
  /** All zeros and no language without summaries. */
  outcome: IPersonalOutcome;
  /** No item and no remainder without summaries. */
  openQuestions: IPersonalOpenQuestions;
  help: IPersonalHelp;
  models: IModelAttribution;
}
