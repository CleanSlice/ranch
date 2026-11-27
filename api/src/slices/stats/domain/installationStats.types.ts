import type { ActivityChannel } from '#/chat/domain/chat.types';
import type { IFigureNote } from './figure.types';
import type { IPeriodRange, Period } from './period';
import type { IComparedCount } from './personalStats.types';

// The installation's statistics for a period (CLEAN-265; spec 038,
// contracts/api.md, `GET /stats/installation`). The shape the route and the
// tool `get_installation_stats` both answer with.
//
// Counts, sums, names of agents and models, the state and cause of
// incidents, and times. Nothing here names a person, holds a chat identity
// or repeats anything that was written (FR-021): people are a number.
//
// Every figure, totals included, is of the agents the caller reaches. The
// ones built from conversations (people, quality, channels) also leave out
// an agent only the Owner manages, and `reach.ownerOnly` names it.

/**
 * The figures of this view that are recorded in a table written for them,
 * and so can start inside the period or the one before it: activity (people,
 * conversations, channels) and limit refusals. Each carries a note when it
 * does. The rest are read in place and never carry one (CLEAN-262): spend,
 * ratings and incidents are their own rows, and no row before some day means
 * nothing happened before it.
 */
export const INSTALLATION_NOTED_FIGURES = ['activity', 'refusals'] as const;

export interface IInstallationQuestion {
  period: Period;
}

export interface IInstallationReach {
  /** True when some agent is hidden from the caller: the view is a part. */
  limited: boolean;
  /** Agents the caller reaches now. */
  agents: number;
  /**
   * Names, as the agents list shows them, of the agents the caller reaches
   * whose conversations are in no figure here because only the Owner
   * manages them (CLEAN-236): the reason owed for what `board.people`,
   * `quality` and `channels` leave out. Empty for the Owner, for a trusted
   * party, and for a caller who reaches no such agent.
   */
  ownerOnly: string[];
}

export interface IInstallationCost extends IComparedCount {
  /**
   * Models used in the period that are not in the price list, most tokens
   * first. Their tokens are in no cost of this answer.
   */
  unpriced: string[];
}

export interface IInstallationBoard {
  tokens: { input: number; output: number };
  /** Model calls. */
  calls: IComparedCount;
  /** USD from the product's price list, models without a price left out. */
  cost: IInstallationCost;
  /**
   * Distinct people who wrote, agent-to-agent traffic excluded, and not to
   * an agent of `reach.ownerOnly`.
   */
  people: IComparedCount;
}

export interface IInstallationDayModel {
  model: string;
  /** Input and output together. */
  tokens: number;
}

export interface IInstallationDay {
  /** The UTC day, `YYYY-MM-DD`. */
  date: string;
  /** USD of the day's priced models; 0 for a day with no usage. */
  cost: number;
  /** Most tokens first; empty for a day with no usage. */
  byModel: IInstallationDayModel[];
}

export interface IInstallationModel {
  model: string;
  /** Whether the price list has it. */
  priced: boolean;
}

export interface IInstallationAgent {
  agentId: string;
  /** The agent's name now, or the one its usage was reported under. */
  name: string;
  /** True when the agent no longer exists. */
  removed: boolean;
  /** The model that took most of its tokens in the period. */
  model: string;
  tokens: number;
  calls: number;
  /** USD over its priced models; null when none of its models has a price. */
  cost: number | null;
  /** True when `cost` leaves out a model of this agent that has no price. */
  partial: boolean;
}

export interface IInstallationIncident {
  /** The short handle people use: "#12". */
  number: number;
  /** The agent's name when the incident opened. */
  agentName: string;
  open: boolean;
  /** The first failure's cause, as the sender wrote it. */
  reason: string | null;
  openedAt: Date;
  closedAt: Date | null;
}

export interface IInstallationRefusals {
  agentId: string;
  name: string;
  /** Requests refused by limits in the period. Above zero. */
  refused: number;
}

export interface IInstallationHealth {
  /** Opened in the period or still open, newest first, capped. */
  incidents: IInstallationIncident[];
  /** How many there are, the ones the cap left out included. */
  incidentsTotal: number;
  /** Agents that refused at least one request, most first. */
  refusals: IInstallationRefusals[];
}

export interface IInstallationQuality {
  agentId: string;
  name: string;
  /** Conversations a person wrote in during the period. */
  conversations: number;
  /** Ratings of its answers that were down. */
  down: number;
  /** Every rating its answers got in the period. */
  rated: number;
}

export interface IInstallationChannel {
  channel: ActivityChannel;
  conversations: number;
}

export interface IInstallationStats {
  period: Period;
  /** UTC days, whoever is looking. */
  range: IPeriodRange;
  reach: IInstallationReach;
  notes: IFigureNote[];
  board: IInstallationBoard;
  /** One entry per UTC day of the period, oldest first. */
  daily: IInstallationDay[];
  /** Every model used in the period, most tokens first. */
  models: IInstallationModel[];
  /** By cost, most first; an agent with no price after the priced ones. */
  agents: IInstallationAgent[];
  /**
   * Priced cost of the period's finished days ÷ those days × 30. Null while
   * no day with usage before it is finished, and when no model with a price
   * ran in those days.
   */
  projection30d: number | null;
  health: IInstallationHealth;
  /** Agents with a conversation or a rating, most conversations first. */
  quality: IInstallationQuality[];
  /** Channels with at least one conversation, most first. */
  channels: IInstallationChannel[];
}
