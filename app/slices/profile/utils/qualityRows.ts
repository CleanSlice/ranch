// The rows of "Where people are unhappy" (CLEAN-265, CLEAN-270): what each
// agent's two shares are, which of them is the highest of its column, and
// the order the rows stand in. Pure on purpose: no Vue, no Nuxt aliases, so
// `bun test` runs it.

import type { IInstallationQuality } from '../domain/stats.types';
import { wholeShare } from './share';

/**
 * What the "left open" cell of a row holds:
 * - `share`: the agent has summarised conversations, and this is the share
 *   of them that were left open;
 * - `none`: summaries are produced, and none of this agent's conversations
 *   has one yet;
 * - `off`: the installation produces no summaries. Decided by the answer's
 *   `summaries.enabled` and never by a zero: with summaries off every count
 *   is zero because nothing was counted.
 */
export type OpenShareState = 'share' | 'none' | 'off';

/**
 * The fewest summarised conversations a share left open needs before it is
 * compared with the others: marked as the highest of its column, and placed
 * among the rows that stand by their share. Three, because under three one
 * conversation is half of the share or all of it: 1 of 1 left open reads
 * 100% and is not worse news than 60 of 100. A share of fewer is still
 * shown, with its "N of M"; it is not ranked.
 */
export const MIN_SUMMARISED_TO_RANK = 3;

/**
 * The same floor for the thumbs-down mark, in rated answers: 1 of 1 rated
 * down is the same flaw in the other column.
 */
export const MIN_RATED_TO_MARK = MIN_SUMMARISED_TO_RANK;

export interface IQualityRow {
  id: string;
  /** As received. */
  name: string;
  conversations: number;
  /** Ratings that were down, out of `rated`. */
  down: number;
  rated: number;
  /** Null when nobody rated an answer: a dash, not 0%. */
  downShare: number | null;
  /**
   * The highest thumbs-down share of the column, above zero, among the
   * agents with at least `MIN_RATED_TO_MARK` rated answers.
   */
  worstDown: boolean;
  /** Conversations left open, out of `summarised`. */
  open: number;
  summarised: number;
  openState: OpenShareState;
  /** Set for `share` only. */
  openShare: number | null;
  /**
   * The highest share left open of the column, above zero, among the agents
   * with at least `MIN_SUMMARISED_TO_RANK` summarised conversations.
   */
  worstOpen: boolean;
}

/** Whether the row's share left open is of enough to be compared. */
function ranked(row: IQualityRow): boolean {
  return row.openShare !== null && row.summarised >= MIN_SUMMARISED_TO_RANK;
}

/**
 * The rows as the table draws them.
 *
 * A share is a whole percent (`wholeShare`), and the highest of a column is
 * decided on that: two agents that print "33%" are equally the highest, and
 * both are marked. Nothing is the highest while every share is zero. Only
 * a share of enough is compared (`MIN_SUMMARISED_TO_RANK`,
 * `MIN_RATED_TO_MARK`): one of fewer is shown and never marked, and where
 * every share is of fewer nothing is.
 *
 * With summaries on, the order starts as the prototype's: by the share left
 * open, highest first. Equal shares go by conversations, most first (the
 * prototype left them in the order of its agent list, which says nothing
 * here), and what is still equal keeps the order it came in. After them
 * stand the rows whose share is not compared, a share of fewer than the
 * minimum and no share at all alike, by conversations, most first: the
 * prototype stood an agent without a share as zero, which put it above an
 * agent known to have left nothing open. With summaries off there is no
 * share to order by and the rows keep the API's order, most conversations
 * first.
 */
export function qualityRows(
  quality: readonly IInstallationQuality[],
  summariesEnabled: boolean,
): IQualityRow[] {
  const rows: IQualityRow[] = [];
  let worstDown = 0;
  let worstOpen = 0;
  for (let index = 0; index < quality.length; index++) {
    const row = quality[index]!;
    const downShare = wholeShare(row.down, row.rated);
    const openShare = summariesEnabled ? wholeShare(row.open, row.summarised) : null;
    if (downShare !== null && row.rated >= MIN_RATED_TO_MARK && downShare > worstDown) {
      worstDown = downShare;
    }
    if (
      openShare !== null &&
      row.summarised >= MIN_SUMMARISED_TO_RANK &&
      openShare > worstOpen
    ) {
      worstOpen = openShare;
    }
    rows.push({
      id: row.agentId,
      name: row.name,
      conversations: row.conversations,
      down: row.down,
      rated: row.rated,
      downShare,
      worstDown: false,
      open: row.open,
      summarised: row.summarised,
      openState: !summariesEnabled ? 'off' : openShare === null ? 'none' : 'share',
      openShare,
      worstOpen: false,
    });
  }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    row.worstDown =
      row.downShare !== null &&
      row.rated >= MIN_RATED_TO_MARK &&
      worstDown > 0 &&
      row.downShare === worstDown;
    row.worstOpen = ranked(row) && worstOpen > 0 && row.openShare === worstOpen;
  }
  if (!summariesEnabled) return rows;

  // The place each row came in is its last word in the order.
  const place = new Map<IQualityRow, number>();
  for (let index = 0; index < rows.length; index++) place.set(rows[index]!, index);
  return rows.sort((a, b) => {
    const aRanked = ranked(a);
    const bRanked = ranked(b);
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    // Among the rows that are not compared the share says nothing.
    const byShare = aRanked ? (b.openShare ?? 0) - (a.openShare ?? 0) : 0;
    return byShare || b.conversations - a.conversations || place.get(a)! - place.get(b)!;
  });
}

/**
 * Whether a row holds a dash for want of a summary: summaries are produced,
 * and none of that agent's conversations has one yet. The table then says
 * under itself what the dash means, in words anyone can see: a dash
 * explained only to a screen reader is a riddle on a phone. Never true with
 * summaries off, where the dash has a line of its own.
 */
export function anyWithoutSummary(rows: readonly IQualityRow[]): boolean {
  for (let index = 0; index < rows.length; index++) {
    if (rows[index]!.openState === 'none') return true;
  }
  return false;
}
