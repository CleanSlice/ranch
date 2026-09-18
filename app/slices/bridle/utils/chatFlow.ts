// Twin of admin/slices/bridle/utils/chatFlow.ts — change them together.
//
// What the chat template iterates (CLEAN-102, research D1): messages and
// thinking blocks in ARRIVAL order, with day separators between them. Ordered
// by `seq` and nothing else — `ts` mixes the browser's clock with the agent's,
// and sorting by it is what used to put an answer above its question. Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

import type {
  IBridleMessage,
  IBridleThinkingBlock,
} from '../domain/bridle.types';

export interface IChatFlowOptions {
  /** Formats the long date on a separator older than yesterday. */
  locale: string;
  /** "Now" in epoch ms — injected so today / yesterday are testable. */
  now: number;
}

export interface IChatFlowMessageItem {
  key: string;
  seq: number;
  kind: 'message';
  message: IBridleMessage;
}

export interface IChatFlowBlockItem {
  key: string;
  seq: number;
  kind: 'block';
  block: IBridleThinkingBlock;
}

export interface IChatFlowDayItem {
  key: string;
  /** The `seq` of the message it precedes. */
  seq: number;
  kind: 'day';
  ts: number;
  /** Today / yesterday travel as a translation key (docs/i18n.md)… */
  labelKey?: 'chat.day_today' | 'chat.day_yesterday';
  /** …anything older as a date already formatted for the locale. */
  label?: string;
}

export type IChatFlowItem =
  | IChatFlowMessageItem
  | IChatFlowBlockItem
  | IChatFlowDayItem;

/** The next free sequence number: one past the highest in use, from 1. */
export function nextSeq(items: ReadonlyArray<{ seq?: number }>): number {
  let max = 0;
  for (const item of items) {
    if (typeof item.seq === 'number' && item.seq > max) max = item.seq;
  }
  return max + 1;
}

/**
 * Number the items that lack a `seq`, in array order — the order a
 * conversation stored before CLEAN-102 was appended in, which is the order
 * the person saw. Items that already carry one are returned untouched.
 */
export function numberLegacy<T extends { seq?: number }>(
  items: readonly T[],
): Array<T & { seq: number }> {
  let last = 0;
  return items.map((item) => {
    if (typeof item.seq === 'number') {
      last = Math.max(last, item.seq);
      return item as T & { seq: number };
    }
    last += 1;
    return { ...item, seq: last };
  });
}

/** Local midnight of the day `ts` falls on. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayItem(
  message: IBridleMessage & { seq: number },
  options: IChatFlowOptions,
): IChatFlowDayItem {
  const day = startOfDay(message.ts);
  const today = startOfDay(options.now);
  // Through the calendar, not `today - 24h`: a DST day is not 24 hours long.
  const t = new Date(today);
  const yesterday = new Date(
    t.getFullYear(),
    t.getMonth(),
    t.getDate() - 1,
  ).getTime();

  const base = {
    key: `day:${message.id}`,
    seq: message.seq,
    kind: 'day' as const,
    ts: message.ts,
  };
  if (day === today) return { ...base, labelKey: 'chat.day_today' };
  if (day === yesterday) return { ...base, labelKey: 'chat.day_yesterday' };
  return {
    ...base,
    label: new Intl.DateTimeFormat(options.locale, { dateStyle: 'long' }).format(
      message.ts,
    ),
  };
}

/**
 * Build the visible flow. A day separator goes in wherever the calendar day
 * changes between two consecutive messages, and above the first message when
 * the conversation did not start today — otherwise the times under an old
 * conversation would belong to no date at all.
 */
export function buildChatFlow(
  messages: readonly IBridleMessage[],
  blocks: readonly IBridleThinkingBlock[],
  options: IChatFlowOptions,
): IChatFlowItem[] {
  const items: Array<IChatFlowMessageItem | IChatFlowBlockItem> = [];
  for (const message of numberLegacy(messages)) {
    items.push({ key: message.id, seq: message.seq, kind: 'message', message });
  }
  for (const block of blocks) {
    items.push({
      key: `${block.turnId}:${block.seg}`,
      // A block without a `seq` cannot come from the store; sink it to the
      // end rather than guess a position from its agent-clock `ts`.
      seq: block.seq ?? Number.MAX_SAFE_INTEGER,
      kind: 'block',
      block,
    });
  }
  // Array.prototype.sort is stable: equal `seq` keeps insertion order.
  items.sort((a, b) => a.seq - b.seq);

  const flow: IChatFlowItem[] = [];
  let previousDay: number | null = null;
  const today = startOfDay(options.now);
  for (const item of items) {
    if (item.kind === 'message') {
      const day = startOfDay(item.message.ts);
      const changed = previousDay === null ? day !== today : day !== previousDay;
      if (changed) {
        flow.push(dayItem({ ...item.message, seq: item.seq }, options));
      }
      previousDay = day;
    }
    flow.push(item);
  }
  return flow;
}
