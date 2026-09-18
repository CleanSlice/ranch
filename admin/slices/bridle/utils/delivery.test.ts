// TWIN FILE: `app/slices/bridle/utils/delivery.test.ts` — change them together.
import { describe, expect, test } from 'bun:test'
import { FAILED_MS, SLOW_MS, nextDelivery, type IDeliveryState } from './delivery'

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
})
