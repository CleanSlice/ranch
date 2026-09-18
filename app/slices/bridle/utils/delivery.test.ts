import { describe, expect, test } from 'bun:test';
import { BridleDeliveryStates } from '../domain/bridle.types';
import {
  FAILED_MS,
  SLOW_MS,
  failureHintKey,
  nextDelivery,
} from './delivery';

const { Sending, Slow, Delivered, Failed } = BridleDeliveryStates;

describe('nextDelivery', () => {
  test('sent starts a message as sending', () => {
    expect(nextDelivery({}, { type: 'sent' })).toEqual({ delivery: Sending });
  });

  test('thresholds are the documented ones', () => {
    expect(SLOW_MS).toBe(5000);
    expect(FAILED_MS).toBe(30000);
  });

  test('tick below the slow threshold changes nothing', () => {
    expect(
      nextDelivery({ delivery: Sending }, { type: 'tick', elapsedMs: 4999 }),
    ).toEqual({ delivery: Sending });
  });

  test('tick at 5 s turns sending into slow', () => {
    expect(
      nextDelivery({ delivery: Sending }, { type: 'tick', elapsedMs: SLOW_MS }),
    ).toEqual({ delivery: Slow });
  });

  test('tick at 30 s fails sending and slow with TIMEOUT', () => {
    for (const delivery of [Sending, Slow]) {
      expect(
        nextDelivery({ delivery }, { type: 'tick', elapsedMs: FAILED_MS }),
      ).toEqual({ delivery: Failed, failureCode: 'TIMEOUT' });
    }
  });

  test('a late tick never touches a settled message', () => {
    expect(
      nextDelivery({ delivery: Delivered }, { type: 'tick', elapsedMs: 60000 }),
    ).toEqual({ delivery: Delivered });
    expect(
      nextDelivery(
        { delivery: Failed, failureCode: 'AGENT_OFFLINE' },
        { type: 'tick', elapsedMs: 60000 },
      ),
    ).toEqual({ delivery: Failed, failureCode: 'AGENT_OFFLINE' });
  });

  test('ackAccepted delivers from sending and from slow', () => {
    for (const delivery of [Sending, Slow]) {
      expect(nextDelivery({ delivery }, { type: 'ackAccepted' })).toEqual({
        delivery: Delivered,
      });
    }
  });

  test('a late ackAccepted moves failed to delivered and drops the code', () => {
    expect(
      nextDelivery(
        { delivery: Failed, failureCode: 'TIMEOUT' },
        { type: 'ackAccepted' },
      ),
    ).toEqual({ delivery: Delivered });
  });

  test('ackRejected fails an in-flight message with the hub code', () => {
    for (const delivery of [Sending, Slow]) {
      expect(
        nextDelivery({ delivery }, { type: 'ackRejected', code: 'AGENT_OFFLINE' }),
      ).toEqual({ delivery: Failed, failureCode: 'AGENT_OFFLINE' });
    }
  });

  test('ackRejected never un-delivers a message', () => {
    expect(
      nextDelivery(
        { delivery: Delivered },
        { type: 'ackRejected', code: 'TIMEOUT' },
      ),
    ).toEqual({ delivery: Delivered });
  });

  test('pageLoad fails what was still in flight', () => {
    for (const delivery of [Sending, Slow]) {
      expect(nextDelivery({ delivery }, { type: 'pageLoad' })).toEqual({
        delivery: Failed,
        failureCode: 'TIMEOUT',
      });
    }
  });

  test('pageLoad keeps delivered, failed and legacy messages as they are', () => {
    expect(nextDelivery({ delivery: Delivered }, { type: 'pageLoad' })).toEqual({
      delivery: Delivered,
    });
    expect(
      nextDelivery(
        { delivery: Failed, failureCode: 'OFFLINE' },
        { type: 'pageLoad' },
      ),
    ).toEqual({ delivery: Failed, failureCode: 'OFFLINE' });
    // No `delivery` at all: stored before CLEAN-102, which means delivered.
    expect(nextDelivery({}, { type: 'pageLoad' })).toEqual({
      delivery: Delivered,
    });
  });

  test('resend puts a failed message back in flight and drops the code', () => {
    expect(
      nextDelivery(
        { delivery: Failed, failureCode: 'AGENT_OFFLINE' },
        { type: 'resend' },
      ),
    ).toEqual({ delivery: Sending });
  });

  test('resend is refused for anything that has not failed', () => {
    for (const delivery of [Sending, Slow, Delivered]) {
      expect(nextDelivery({ delivery }, { type: 'resend' })).toEqual({
        delivery,
      });
    }
  });
});

describe('failureHintKey', () => {
  test('known codes have wording of their own', () => {
    expect(failureHintKey('AGENT_OFFLINE')).toBe(
      'chat.not_delivered_agent_offline',
    );
    expect(failureHintKey('OFFLINE')).toBe('chat.not_delivered_offline');
    expect(failureHintKey('TIMEOUT')).toBe('chat.not_delivered_timeout');
    expect(failureHintKey('ATTACHMENT_FAILED')).toBe(
      'chat.not_delivered_attachment_failed',
    );
  });

  test('anything else falls back to the general hint', () => {
    expect(failureHintKey('SHARE_REJECTED')).toBe('chat.not_delivered_hint');
    expect(failureHintKey(undefined)).toBe('chat.not_delivered_hint');
  });
});
