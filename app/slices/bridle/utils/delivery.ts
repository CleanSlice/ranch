// Twin of admin/slices/bridle/utils/delivery.ts — change them together.
//
// The delivery state machine for the person's own messages (CLEAN-102,
// specs/015-chat-message-reliability/data-model.md). Pure on purpose: no Vue,
// no Nuxt aliases, so `bun test` runs it and the store only has to feed it
// events.

import { BridleDeliveryStates } from '../domain/bridle.types';

/** Without an ack for this long the bubble says it is still trying. */
export const SLOW_MS = 5000;
/** Without an ack for this long the message counts as not delivered. */
export const FAILED_MS = 30000;

/** Set by the client itself; every other code comes from the hub's ack. */
export const FAILURE_TIMEOUT = 'TIMEOUT';
export const FAILURE_OFFLINE = 'OFFLINE';

export interface IDeliveryState {
  /** Absent means delivered — messages stored before CLEAN-102 have none. */
  delivery?: BridleDeliveryStates;
  failureCode?: string;
}

/** What the reducer hands back: the state is always named, never implied. */
export interface IDeliveryResult {
  delivery: BridleDeliveryStates;
  failureCode?: string;
}

export type IDeliveryEvent =
  | { type: 'sent' }
  | { type: 'tick'; elapsedMs: number }
  | { type: 'ackAccepted' }
  | { type: 'ackRejected'; code: string }
  | { type: 'pageLoad' }
  | { type: 'resend' };

function isInFlight(delivery: BridleDeliveryStates): boolean {
  return (
    delivery === BridleDeliveryStates.Sending ||
    delivery === BridleDeliveryStates.Slow
  );
}

/**
 * The next state of one message. An event that does not apply to the current
 * state returns the state unchanged, so a late timer or a stray ack can never
 * move a message backwards.
 */
export function nextDelivery(
  state: IDeliveryState,
  event: IDeliveryEvent,
): IDeliveryResult {
  const delivery = state.delivery ?? BridleDeliveryStates.Delivered;
  const same: IDeliveryResult = {
    delivery,
    ...(state.failureCode ? { failureCode: state.failureCode } : {}),
  };

  switch (event.type) {
    case 'sent':
      return { delivery: BridleDeliveryStates.Sending };

    case 'tick':
      if (!isInFlight(delivery)) return same;
      if (event.elapsedMs >= FAILED_MS) {
        return {
          delivery: BridleDeliveryStates.Failed,
          failureCode: FAILURE_TIMEOUT,
        };
      }
      if (event.elapsedMs >= SLOW_MS) {
        return { delivery: BridleDeliveryStates.Slow };
      }
      return same;

    case 'ackAccepted':
      // Also from `failed`: an ack that outlived our patience still means the
      // agent has the message, and saying otherwise would invite a duplicate.
      return { delivery: BridleDeliveryStates.Delivered };

    case 'ackRejected':
      if (delivery === BridleDeliveryStates.Delivered) return same;
      return { delivery: BridleDeliveryStates.Failed, failureCode: event.code };

    case 'pageLoad':
      // The ack was owed to a socket that no longer exists.
      if (!isInFlight(delivery)) return same;
      return {
        delivery: BridleDeliveryStates.Failed,
        failureCode: FAILURE_TIMEOUT,
      };

    case 'resend':
      if (delivery !== BridleDeliveryStates.Failed) return same;
      return { delivery: BridleDeliveryStates.Sending };
  }
}

/**
 * The line explaining a failed message, as a translation key — copy decided
 * in script travels as a key (docs/i18n.md). Codes without wording of their
 * own fall back to the general hint.
 */
export function failureHintKey(code: string | undefined): string {
  switch (code) {
    case 'AGENT_OFFLINE':
      return 'chat.not_delivered_agent_offline';
    case FAILURE_OFFLINE:
      return 'chat.not_delivered_offline';
    case FAILURE_TIMEOUT:
      return 'chat.not_delivered_timeout';
    case 'ATTACHMENT_FAILED':
      return 'chat.not_delivered_attachment_failed';
    default:
      return 'chat.not_delivered_hint';
  }
}
