/**
 * Delivery state of the operator's own message, as a pure reducer.
 *
 * TWIN FILE: `app/slices/bridle/utils/delivery.ts` holds the same state machine
 * for the app console. Change them together.
 *
 *            send()              5 s without ack          30 s without ack
 *   (none) ─────────► sending ──────────────────► slow ──────────────────► failed
 *                        │                         │                        │ ▲
 *                        │ ack accepted            │ ack accepted           │ │ resend() (same id)
 *                        ▼                         ▼                        ▼ │
 *                    delivered ◄───────────────────┘                     sending
 *                        ▲
 *                        │ ack rejected ──► failed (with failureCode)
 *
 * See specs/015-chat-message-reliability/data-model.md. No Vue / Nuxt imports:
 * this file runs under `bun test`.
 */

/** Without an ack for this long the bubble says "taking longer than usual". */
export const SLOW_MS = 5000
/** Without an ack for this long the message is shown as not delivered. */
export const FAILED_MS = 30000

export type BridleDelivery = 'sending' | 'slow' | 'delivered' | 'failed'

export interface IDeliveryState {
  /** Absent means delivered — replayed and legacy messages carry no state. */
  delivery?: BridleDelivery
  failureCode?: string
}

export type DeliveryEvent =
  | { type: 'sent' }
  | { type: 'tick'; elapsedMs: number }
  | { type: 'ackAccepted' }
  | { type: 'ackRejected'; code: string }
  | { type: 'pageLoad' }
  | { type: 'resend' }

function isPending(state: IDeliveryState): boolean {
  return state.delivery === 'sending' || state.delivery === 'slow'
}

export function nextDelivery(
  state: IDeliveryState,
  event: DeliveryEvent,
): IDeliveryState {
  switch (event.type) {
    case 'sent':
      return { delivery: 'sending' }

    case 'tick':
      if (!isPending(state)) return state
      if (event.elapsedMs >= FAILED_MS) {
        return { delivery: 'failed', failureCode: 'TIMEOUT' }
      }
      if (event.elapsedMs >= SLOW_MS) return { delivery: 'slow' }
      return state

    case 'ackAccepted':
      // Also out of `failed`: an ack that arrives after we gave up still
      // means the hub handed the message over.
      return { delivery: 'delivered' }

    case 'ackRejected':
      // A message the hub already accepted cannot be un-delivered.
      if (state.delivery === 'delivered' || state.delivery === undefined) return state
      return { delivery: 'failed', failureCode: event.code }

    case 'pageLoad':
      // The ack can no longer arrive: the socket it was due on is gone.
      if (!isPending(state)) return state
      return { delivery: 'failed', failureCode: 'TIMEOUT' }

    case 'resend':
      if (state.delivery !== 'failed') return state
      return { delivery: 'sending' }
  }
}
