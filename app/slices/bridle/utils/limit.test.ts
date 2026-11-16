import { describe, expect, test } from 'bun:test';

import {
  LIMIT_FALLBACK_WAIT_MS,
  isLimitActive,
  isRateLimitedAck,
  limitFraction,
  limitFrom,
  limitRemainingMs,
  restoredDraft,
  toAgentLimitEvent,
  toRateLimitedAck,
} from './limit';

describe('toRateLimitedAck', () => {
  test('reads the refusal with its wait and its window', () => {
    expect(
      toRateLimitedAck({
        status: 'rejected',
        code: 'RATE_LIMITED',
        retryAfterMs: 42_000,
        window: 'hour',
      }),
    ).toEqual({
      status: 'rejected',
      code: 'RATE_LIMITED',
      retryAfterMs: 42_000,
      window: 'hour',
    });
  });

  test('any other rejection is not one', () => {
    expect(toRateLimitedAck({ status: 'rejected', code: 'AGENT_OFFLINE' })).toBe(null);
    expect(toRateLimitedAck({ status: 'accepted', code: 'RATE_LIMITED' })).toBe(null);
    expect(toRateLimitedAck({})).toBe(null);
  });

  test('a refusal without a usable wait is still a calm refusal', () => {
    const waits: unknown[] = [undefined, 0, -5, Number.NaN, '42000'];
    for (let i = 0; i < waits.length; i++) {
      expect(
        toRateLimitedAck({
          status: 'rejected',
          code: 'RATE_LIMITED',
          retryAfterMs: waits[i],
          window: 'minute',
        })?.retryAfterMs,
      ).toBe(LIMIT_FALLBACK_WAIT_MS);
    }
  });

  test('a window the console does not know reads as the shortest', () => {
    expect(
      toRateLimitedAck({
        status: 'rejected',
        code: 'RATE_LIMITED',
        retryAfterMs: 1000,
        window: 'week',
      })?.window,
    ).toBe('minute');
  });
});

describe('toAgentLimitEvent', () => {
  test('reads a full limit', () => {
    expect(
      toAgentLimitEvent({
        type: 'agent_limit',
        agentId: 'a1',
        limited: true,
        retryAfterMs: 1_800_000,
        window: 'day',
      }),
    ).toEqual({ limited: true, retryAfterMs: 1_800_000, window: 'day' });
  });

  test('reads room made early', () => {
    expect(toAgentLimitEvent({ type: 'agent_limit', agentId: 'a1', limited: false })).toEqual({
      limited: false,
    });
  });

  test('a full limit with no end is not shown at all', () => {
    expect(toAgentLimitEvent({ limited: true })).toBe(null);
    expect(toAgentLimitEvent({ limited: true, retryAfterMs: 0, window: 'hour' })).toBe(null);
  });

  test('a frame that says neither is ignored', () => {
    expect(toAgentLimitEvent({})).toBe(null);
    expect(toAgentLimitEvent({ limited: 'yes', retryAfterMs: 1000 })).toBe(null);
  });
});

describe('isRateLimitedAck', () => {
  test('tells the limit refusal from the others', () => {
    expect(
      isRateLimitedAck({
        status: 'rejected',
        code: 'RATE_LIMITED',
        retryAfterMs: 1000,
        window: 'minute',
      }),
    ).toBe(true);
    expect(isRateLimitedAck({ status: 'rejected', code: 'AGENT_OFFLINE' })).toBe(false);
    expect(isRateLimitedAck({ status: 'accepted', messageId: 'm', ts: 1 })).toBe(false);
  });
});

describe('the wait', () => {
  test('ends at now plus the announced wait, on the same clock', () => {
    expect(limitFrom(5_000, 42_000, 'minute')).toEqual({ until: 47_000, window: 'minute' });
  });

  test('runs down to zero and stops there', () => {
    const limit = limitFrom(5_000, 42_000, 'minute');
    expect(limitRemainingMs(limit, 5_000)).toBe(42_000);
    expect(limitRemainingMs(limit, 46_999)).toBe(1);
    expect(limitRemainingMs(limit, 47_000)).toBe(0);
    expect(limitRemainingMs(limit, 99_000)).toBe(0);
    expect(limitRemainingMs(null, 0)).toBe(0);
  });

  test('is active until its last millisecond', () => {
    const limit = limitFrom(0, 1000, 'hour');
    expect(isLimitActive(limit, 999)).toBe(true);
    expect(isLimitActive(limit, 1000)).toBe(false);
    expect(isLimitActive(undefined, 0)).toBe(false);
  });
});

describe('restoredDraft', () => {
  test('an empty field takes the refused text as it was', () => {
    expect(restoredDraft('hello there', '')).toBe('hello there');
    expect(restoredDraft('hello there', '   ')).toBe('hello there');
  });

  test('text typed since stays, below what was refused', () => {
    expect(restoredDraft('first thought', 'second thought')).toBe(
      'first thought\nsecond thought',
    );
  });

  test('nothing refused changes nothing', () => {
    expect(restoredDraft('', 'typing…')).toBe('typing…');
  });
});

describe('limitFraction', () => {
  test('is the share of the wait still ahead', () => {
    expect(limitFraction(60_000, 60_000)).toBe(1);
    expect(limitFraction(15_000, 60_000)).toBe(0.25);
    expect(limitFraction(0, 60_000)).toBe(0);
  });

  test('never leaves 0..1', () => {
    expect(limitFraction(90_000, 60_000)).toBe(1);
    expect(limitFraction(-1, 60_000)).toBe(0);
    expect(limitFraction(10, 0)).toBe(0);
  });
});
