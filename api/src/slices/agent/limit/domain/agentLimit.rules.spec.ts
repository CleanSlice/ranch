import {
  LimitRuleError,
  normalizeLimits,
  resolveLimitChange,
} from './agentLimit.rules';
import { IAgentLimits, LIMIT_MAX } from './agentLimit.types';

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof LimitRuleError ? err.code : 'OTHER';
  }
};

const some: IAgentLimits = { perMinute: 10, perHour: null, perDay: null };

describe('normalizeLimits', () => {
  it('reads absent, null and empty as "not limited"', () => {
    expect(normalizeLimits({ perMinute: 5 })).toEqual({
      perMinute: 5,
      perHour: null,
      perDay: null,
    });
    expect(
      normalizeLimits({ perMinute: null, perHour: '', perDay: 100 }),
    ).toEqual({
      perMinute: null,
      perHour: null,
      perDay: 100,
    });
  });

  it('is "off" when every window is empty', () => {
    expect(normalizeLimits(null)).toBeNull();
    expect(normalizeLimits(undefined)).toBeNull();
    expect(normalizeLimits({})).toBeNull();
    expect(
      normalizeLimits({ perMinute: null, perHour: null, perDay: null }),
    ).toBeNull();
  });

  it('refuses anything that is not a whole number from 1 to the cap', () => {
    for (const bad of [0, -1, 1.5, LIMIT_MAX + 1, '5', NaN, Infinity, true]) {
      expect(codeOf(() => normalizeLimits({ perMinute: bad }))).toBe(
        'LIMIT_OUT_OF_RANGE',
      );
    }
    expect(normalizeLimits({ perMinute: 1 })?.perMinute).toBe(1);
    expect(normalizeLimits({ perDay: LIMIT_MAX })?.perDay).toBe(LIMIT_MAX);
  });

  it('refuses a longer window that allows fewer requests than a shorter one', () => {
    expect(codeOf(() => normalizeLimits({ perMinute: 10, perHour: 5 }))).toBe(
      'LIMIT_WINDOWS_CONTRADICT',
    );
    expect(codeOf(() => normalizeLimits({ perHour: 10, perDay: 9 }))).toBe(
      'LIMIT_WINDOWS_CONTRADICT',
    );
    expect(codeOf(() => normalizeLimits({ perMinute: 10, perDay: 9 }))).toBe(
      'LIMIT_WINDOWS_CONTRADICT',
    );
  });

  it('allows equal values across windows', () => {
    expect(normalizeLimits({ perMinute: 10, perHour: 10, perDay: 10 })).toEqual(
      {
        perMinute: 10,
        perHour: 10,
        perDay: 10,
      },
    );
  });
});

describe('resolveLimitChange', () => {
  it('refuses making an agent public with no limit', () => {
    expect(
      codeOf(() =>
        resolveLimitChange(
          { isPublic: false, limits: null },
          { isPublic: true },
        ),
      ),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
  });

  it('allows it in the same request that sets a limit', () => {
    expect(
      resolveLimitChange(
        { isPublic: false, limits: null },
        { isPublic: true, limits: { perMinute: 3 } },
      ),
    ).toEqual({
      limitsTouched: true,
      limits: { perMinute: 3, perHour: null, perDay: null },
    });
  });

  it('allows it when the agent already has limits', () => {
    expect(
      resolveLimitChange({ isPublic: false, limits: some }, { isPublic: true }),
    ).toEqual({
      limitsTouched: false,
      limits: some,
    });
  });

  it('refuses removing the last limit from a public agent', () => {
    expect(
      codeOf(() =>
        resolveLimitChange({ isPublic: true, limits: some }, { limits: null }),
      ),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
    expect(
      codeOf(() =>
        resolveLimitChange(
          { isPublic: true, limits: some },
          { limits: { perMinute: null } },
        ),
      ),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
  });

  it('lets a private agent have limits, or none', () => {
    expect(
      resolveLimitChange({ isPublic: false, limits: some }, { limits: null }),
    ).toEqual({
      limitsTouched: true,
      limits: null,
    });
    expect(
      resolveLimitChange(
        { isPublic: false, limits: null },
        { limits: { perDay: 9 } },
      ).limits,
    ).toEqual({
      perMinute: null,
      perHour: null,
      perDay: 9,
    });
  });

  it('keeps limits when a public agent becomes private, and makes them optional', () => {
    expect(
      resolveLimitChange({ isPublic: true, limits: some }, { isPublic: false }),
    ).toEqual({
      limitsTouched: false,
      limits: some,
    });
    expect(
      resolveLimitChange(
        { isPublic: true, limits: some },
        { isPublic: false, limits: null },
      ),
    ).toEqual({ limitsTouched: true, limits: null });
  });

  it('never refuses a request that sets neither visibility nor limits', () => {
    // An agent that was public before limits existed can still be renamed.
    expect(resolveLimitChange({ isPublic: true, limits: null }, {})).toEqual({
      limitsTouched: false,
      limits: null,
    });
  });

  it('does not refuse a request that repeats "public" for an already public agent', () => {
    // An older console sends the flag with every edit.
    expect(
      resolveLimitChange({ isPublic: true, limits: null }, { isPublic: true }),
    ).toEqual({
      limitsTouched: false,
      limits: null,
    });
  });

  it('does refuse a legacy public agent once its visibility settings are saved', () => {
    // The card's save always carries limits, even empty.
    expect(
      codeOf(() =>
        resolveLimitChange(
          { isPublic: true, limits: null },
          { isPublic: true, limits: null },
        ),
      ),
    ).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
  });

  it('passes validation refusals through', () => {
    expect(
      codeOf(() =>
        resolveLimitChange(
          { isPublic: false, limits: null },
          { limits: { perMinute: 0 } },
        ),
      ),
    ).toBe('LIMIT_OUT_OF_RANGE');
  });
});
