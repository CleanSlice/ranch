// TWIN FILE: `app/slices/bridle/utils/delivery.test.ts` — change them together.
import { describe, expect, test } from 'bun:test'
import {
  DeliveryFailureCodes,
  FAILED_MS,
  SLOW_MS,
  deliveryFailureReason,
  nextDelivery,
  type IDeliveryState,
} from './delivery'

const sending: IDeliveryState = { delivery: 'sending' }
const slow: IDeliveryState = { delivery: 'slow' }
const delivered: IDeliveryState = { delivery: 'delivered' }
const failed: IDeliveryState = { delivery: 'failed', failureCode: 'AGENT_OFFLINE' }

describe('nextDelivery', () => {
  test('thresholds are the documented ones', () => {
    expect(SLOW_MS).toBe(5000)
    expect(FAILED_MS).toBe(30000)
  })

  test('sent → sending', () => {
    expect(nextDelivery({}, { type: 'sent' })).toEqual({ delivery: 'sending' })
  })

  test('tick below 5 s changes nothing', () => {
    expect(nextDelivery(sending, { type: 'tick', elapsedMs: SLOW_MS - 1 })).toEqual(sending)
  })

  test('tick at 5 s: sending → slow', () => {
    expect(nextDelivery(sending, { type: 'tick', elapsedMs: SLOW_MS })).toEqual(slow)
  })

  test('tick at 30 s: sending / slow → failed TIMEOUT', () => {
    const timeout = { delivery: 'failed', failureCode: 'TIMEOUT' }
    expect(nextDelivery(slow, { type: 'tick', elapsedMs: FAILED_MS })).toEqual(timeout)
    expect(nextDelivery(sending, { type: 'tick', elapsedMs: FAILED_MS })).toEqual(timeout)
  })

  test('tick never touches a settled message', () => {
    expect(nextDelivery(delivered, { type: 'tick', elapsedMs: FAILED_MS })).toEqual(delivered)
    expect(nextDelivery(failed, { type: 'tick', elapsedMs: FAILED_MS })).toEqual(failed)
    expect(nextDelivery({}, { type: 'tick', elapsedMs: FAILED_MS })).toEqual({})
  })

  test('ackAccepted: sending / slow → delivered', () => {
    expect(nextDelivery(sending, { type: 'ackAccepted' })).toEqual(delivered)
    expect(nextDelivery(slow, { type: 'ackAccepted' })).toEqual(delivered)
  })

  test('a late ackAccepted moves failed → delivered and drops the code', () => {
    const timedOut: IDeliveryState = { delivery: 'failed', failureCode: 'TIMEOUT' }
    expect(nextDelivery(timedOut, { type: 'ackAccepted' })).toEqual(delivered)
  })

  test('ackRejected: sending / slow → failed with the code', () => {
    expect(nextDelivery(sending, { type: 'ackRejected', code: 'AGENT_OFFLINE' })).toEqual(failed)
    expect(nextDelivery(slow, { type: 'ackRejected', code: 'ATTACHMENT_FAILED' })).toEqual({
      delivery: 'failed',
      failureCode: 'ATTACHMENT_FAILED',
    })
  })

  test('ackRejected cannot un-deliver a message', () => {
    expect(nextDelivery(delivered, { type: 'ackRejected', code: 'EMPTY' })).toEqual(delivered)
    expect(nextDelivery({}, { type: 'ackRejected', code: 'EMPTY' })).toEqual({})
  })

  test('pageLoad: sending / slow → failed TIMEOUT, settled states stay', () => {
    const timeout = { delivery: 'failed', failureCode: 'TIMEOUT' }
    expect(nextDelivery(sending, { type: 'pageLoad' })).toEqual(timeout)
    expect(nextDelivery(slow, { type: 'pageLoad' })).toEqual(timeout)
    expect(nextDelivery(failed, { type: 'pageLoad' })).toEqual(failed)
    expect(nextDelivery(delivered, { type: 'pageLoad' })).toEqual(delivered)
  })

  test('resend: failed → sending, code cleared; a no-op anywhere else', () => {
    expect(nextDelivery(failed, { type: 'resend' })).toEqual(sending)
    expect(nextDelivery(delivered, { type: 'resend' })).toEqual(delivered)
    expect(nextDelivery(slow, { type: 'resend' })).toEqual(slow)
  })

  // CLEAN-224. Operators are not limited, so this ack should never arrive
  // here — if it does, it is a failure like any other, with its own name.
  test('ackRejected RATE_LIMITED: sending / slow → failed with that code', () => {
    const limited = { delivery: 'failed', failureCode: 'RATE_LIMITED' }
    expect(nextDelivery(sending, { type: 'ackRejected', code: 'RATE_LIMITED' })).toEqual(limited)
    expect(nextDelivery(slow, { type: 'ackRejected', code: 'RATE_LIMITED' })).toEqual(limited)
  })

  test('a RATE_LIMITED message can be resent like any failed one', () => {
    const limited: IDeliveryState = { delivery: 'failed', failureCode: 'RATE_LIMITED' }
    expect(nextDelivery(limited, { type: 'resend' })).toEqual(sending)
  })
})

describe('deliveryFailureReason', () => {
  test('every known code has its own sentence', () => {
    expect(deliveryFailureReason('AGENT_OFFLINE')).toBe('the agent is offline')
    expect(deliveryFailureReason('OFFLINE')).toBe('the chat is not connected')
    expect(deliveryFailureReason('TIMEOUT')).toBe('no confirmation from the server')
    expect(deliveryFailureReason('ATTACHMENT_FAILED')).toBe('an attachment could not be read')
  })

  test('RATE_LIMITED is a named reason, not the fallback', () => {
    expect(DeliveryFailureCodes.RateLimited).toBe('RATE_LIMITED')
    expect(deliveryFailureReason('RATE_LIMITED')).toBe('the agent is at its message limit')
  })

  test('an unknown or missing code gets the general sentence and does not throw', () => {
    expect(deliveryFailureReason('SOMETHING_NEW')).toBe('the server rejected it')
    expect(deliveryFailureReason('')).toBe('the server rejected it')
    expect(deliveryFailureReason(undefined)).toBe('the server rejected it')
    expect(deliveryFailureReason(null)).toBe('the server rejected it')
    // Names every object has must not be mistaken for codes.
    expect(deliveryFailureReason('toString')).toBe('the server rejected it')
    expect(deliveryFailureReason('constructor')).toBe('the server rejected it')
  })
})
