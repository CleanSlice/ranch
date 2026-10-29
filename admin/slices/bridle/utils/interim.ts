/**
 * Narration the agent writes before calling a tool — "Let me check the spec
 * deck…" — is not a reply (CLEAN-189). The runtime marks such a bubble
 * `interim` on `stream_end` and on the stored turn; this console shows it
 * inside the thinking timeline, live and on replay, never as a message.
 *
 * TWIN FILE: `app/slices/bridle/utils/interim.ts` holds the same logic for the
 * app console. Change them together.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`. Index loops on
 * purpose — `bun test` on Windows has crashed on the for-of + while shape.
 */
import type { IBridleMessageData, IBridleThinkingStep, IThinkingBlock } from '../stores/bridle'

/**
 * The `turnId` of a block the narration opened before any thinking step named
 * the turn. The turn's first step adopts the block (store, `thinking` handler).
 */
export const INTERIM_TURN = 'interim'

/** Prefix of the `turnId` of a block rebuilt from replayed bubbles. */
const REPLAY_TURN_PREFIX = 'replay:'

/** A block the transcript load built — it is rebuilt on every load. */
export function isReplayBlock(block: { turnId: string }): boolean {
  return block.turnId.startsWith(REPLAY_TURN_PREFIX)
}

/**
 * One narration bubble as a step of the timeline: the whole text is the row,
 * line breaks folded into spaces, and nothing opens under it. A cut row with
 * the full text as its detail showed the same sentence twice (CLEAN-196).
 * Server text, shown as received — never translated or reformatted.
 */
export function interimStep(bubble: { id: string; text: string }): IBridleThinkingStep {
  return {
    id: bubble.id,
    label: bubble.text.trim().replace(/\s*\n\s*/g, ' '),
    state: 'done',
  }
}

/**
 * The block that sits below every message, when the flow ends with one. That
 * is the segment the narration bubble sealed when its first chunk landed —
 * with the bubble gone it is the tail again, and the narration goes there.
 */
export function trailingBlock<B extends { seq?: number }>(
  messages: ReadonlyArray<{ seq?: number }>,
  blocks: ReadonlyArray<B>,
): B | null {
  let top = Number.NEGATIVE_INFINITY
  for (let i = 0; i < messages.length; i++) {
    const seq = messages[i]!.seq
    if (typeof seq === 'number' && seq > top) top = seq
  }
  let found: B | null = null
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (typeof block.seq !== 'number' || block.seq <= top) continue
    if (!found || block.seq > (found.seq as number)) found = block
  }
  return found
}

export interface IFoldedTranscript {
  messages: IBridleMessageData[]
  blocks: IThinkingBlock[]
}

/**
 * Replay: a run of interim bubbles becomes one finished block in their place
 * — under the first bubble's `seq`, one step per bubble. Everything else
 * passes through untouched, in order.
 */
export function foldReplayedInterim(messages: readonly IBridleMessageData[]): IFoldedTranscript {
  const kept: IBridleMessageData[] = []
  const blocks: IThinkingBlock[] = []
  let run: IBridleMessageData[] = []
  const flush = () => {
    if (run.length === 0) return
    const first = run[0]!
    blocks.push({
      turnId: `${REPLAY_TURN_PREFIX}${first.id}`,
      seg: 0,
      steps: run.map(interimStep),
      status: 'done',
      ts: first.ts,
      ...(typeof first.seq === 'number' ? { seq: first.seq } : {}),
    })
    run = []
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.interim && message.role === 'assistant') {
      run.push(message)
    } else {
      flush()
      kept.push(message)
    }
  }
  flush()
  return { messages: kept, blocks }
}
