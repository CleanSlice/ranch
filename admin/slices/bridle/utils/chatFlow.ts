/**
 * The visible order of a conversation — messages, thinking segments and day
 * separators — as one pure function.
 *
 * TWIN FILE: `app/slices/bridle/utils/chatFlow.ts` holds the same logic for the
 * app console. Change them together.
 *
 * Ordering is by `seq` ONLY. `seq` is the per-conversation arrival sequence the
 * store assigns on append; `ts` comes from whichever clock stamped the item
 * (browser for the operator's own message, agent runtime for replies) and is
 * for display. Sorting by `ts` is what put a reply above its question whenever
 * the two clocks disagreed (CLEAN-102, research F1).
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */

/** The least a message must carry to be placed in the flow. */
export interface IChatFlowMessage {
  id: string
  ts: number
  seq?: number
}

/** The least a thinking segment must carry to be placed in the flow. */
export interface IChatFlowBlock {
  turnId: string
  seg: number
  ts: number
  seq?: number
}

export interface IChatFlowMessageItem<M> {
  key: string
  seq: number
  kind: 'message'
  message: M
}

export interface IChatFlowBlockItem<B> {
  key: string
  seq: number
  kind: 'block'
  block: B
}

export interface IChatFlowDayItem {
  key: string
  /** The `seq` of the message this separator precedes. */
  seq: number
  kind: 'day'
  /** `ts` of the first message of the new day. */
  ts: number
  /** Set when the day is today / yesterday relative to `now`. */
  relative: 'today' | 'yesterday' | null
  /** Long date in `locale` — what to show when `relative` is null. */
  label: string
}

export type ChatFlowItem<M, B> =
  | IChatFlowMessageItem<M>
  | IChatFlowBlockItem<B>
  | IChatFlowDayItem

export interface IChatFlowOptions {
  locale: string
  /** Epoch ms "now" — injected so today / yesterday is testable. */
  now: number
}

/** Local calendar day as a comparable number (y*10000 + m*100 + d). */
function dayOf(ts: number): number {
  const d = new Date(ts)
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function relativeDay(ts: number, now: number): 'today' | 'yesterday' | null {
  const day = dayOf(ts)
  if (day === dayOf(now)) return 'today'
  const y = new Date(now)
  // Calendar arithmetic, not `now - 24h`: a DST day is 23 or 25 hours long.
  y.setDate(y.getDate() - 1)
  return day === dayOf(y.getTime()) ? 'yesterday' : null
}

/**
 * Build the flow the template iterates.
 *
 * Messages without a `seq` (there should be none once the store numbers every
 * append) are numbered in array order; a thinking segment without one sinks to
 * the end rather than being placed by its agent-clock `ts`.
 *
 * A `day` separator goes where the calendar day of `ts` changes between two
 * consecutive MESSAGES — and above the first message when the conversation did
 * not start today, or the times under an old conversation would belong to no
 * date at all. Thinking segments never open a day.
 */
export function buildChatFlow<M extends IChatFlowMessage, B extends IChatFlowBlock>(
  messages: readonly M[],
  blocks: readonly B[],
  options: IChatFlowOptions,
): ChatFlowItem<M, B>[] {
  const items: Array<IChatFlowMessageItem<M> | IChatFlowBlockItem<B>> = [
    ...numberLegacy(messages).map((m, i) => ({
      key: `m-${m.id}`,
      seq: m.seq,
      kind: 'message' as const,
      // The caller's own object, not numberLegacy's copy: the template must
      // render the store's reactive message.
      message: messages[i]!,
    })),
    ...blocks.map(b => ({
      key: `b-${b.turnId}#${b.seg}`,
      seq: b.seq ?? Number.MAX_SAFE_INTEGER,
      kind: 'block' as const,
      block: b,
    })),
  ]
  // Array.prototype.sort is stable: equal `seq` keeps the given order.
  items.sort((a, b) => a.seq - b.seq)

  let dateFormat: Intl.DateTimeFormat | null = null
  const flow: ChatFlowItem<M, B>[] = []
  let previousDay: number | null = null
  const today = dayOf(options.now)

  for (const item of items) {
    if (item.kind === 'message') {
      const day = dayOf(item.message.ts)
      if (previousDay === null ? day !== today : day !== previousDay) {
        dateFormat ??= new Intl.DateTimeFormat(options.locale, { dateStyle: 'long' })
        flow.push({
          key: `d-${item.message.id}`,
          seq: item.seq,
          kind: 'day',
          ts: item.message.ts,
          relative: relativeDay(item.message.ts, options.now),
          label: dateFormat.format(item.message.ts),
        })
      }
      previousDay = day
    }
    flow.push(item)
  }
  return flow
}

/** The next free `seq` for a conversation holding `items`. Starts at 1. */
export function nextSeq(items: ReadonlyArray<{ seq?: number }>): number {
  let max = 0
  for (const item of items) {
    if (typeof item.seq === 'number' && item.seq > max) max = item.seq
  }
  return max + 1
}

/**
 * Number the items that lack a `seq`, in array order — a transcript page comes
 * in file order, which is the order it happened in. An item that already
 * carries a `seq` is returned untouched; one that lacks it gets one past the
 * highest seen so far. The input is not mutated.
 */
export function numberLegacy<T extends { seq?: number }>(
  items: readonly T[],
): Array<T & { seq: number }> {
  let last = 0
  return items.map((item) => {
    if (typeof item.seq === 'number') {
      last = Math.max(last, item.seq)
      return item as T & { seq: number }
    }
    last += 1
    return { ...item, seq: last }
  })
}
