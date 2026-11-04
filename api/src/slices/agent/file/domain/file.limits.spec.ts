import {
  curatedLimitsFrom,
  curatedOverLimit,
  DEFAULT_CURATED_LIMITS,
  fileLimits,
} from './file.limits';

// Curated-file limits (CLEAN-208): what the console shows and every write
// path refuses, read off the agent's own agent.config.json.

describe('curatedLimitsFrom', () => {
  it('reads memory.limits by file name and fills the rest with the runtime defaults', () => {
    const limits = curatedLimitsFrom({
      memory: { limits: { soul: 32000, user: 2000 } },
    });
    expect(limits).toEqual({
      'SOUL.md': 32000,
      'USER.md': 2000,
      'MEMORY.md': DEFAULT_CURATED_LIMITS.memory,
      'HEARTBEAT.md': DEFAULT_CURATED_LIMITS.heartbeat,
    });
  });

  it('is the defaults alone without a config, and ignores values that are not positive numbers', () => {
    expect(curatedLimitsFrom(null)['SOUL.md']).toBe(
      DEFAULT_CURATED_LIMITS.soul,
    );
    expect(
      curatedLimitsFrom({ memory: { limits: { soul: '40000' } } })['SOUL.md'],
    ).toBe(DEFAULT_CURATED_LIMITS.soul);
    expect(
      curatedLimitsFrom({ memory: { limits: { soul: -5 } } })['SOUL.md'],
    ).toBe(DEFAULT_CURATED_LIMITS.soul);
    expect(
      curatedLimitsFrom({ memory: { limits: { soul: 31999.9 } } })['SOUL.md'],
    ).toBe(31999);
  });
});

describe('curatedOverLimit', () => {
  const limits = curatedLimitsFrom({ memory: { limits: { soul: 32000 } } });

  it('names the file, its size, the limit and where the limit lives', () => {
    expect(curatedOverLimit('SOUL.md', 33359, limits)).toBe(
      "SOUL.md is 33359 characters; this agent's limit is 32000 (memory.limits.soul in agent.config.json). Shorten the file or raise the limit, then save again.",
    );
  });

  it('is null at the limit, under it, and for any path that is not a curated root file', () => {
    expect(curatedOverLimit('SOUL.md', 32000, limits)).toBeNull();
    expect(curatedOverLimit('SOUL.md', 10, limits)).toBeNull();
    expect(curatedOverLimit('skills/x/SOUL.md', 99999, limits)).toBeNull();
    expect(curatedOverLimit('notes.md', 99999, limits)).toBeNull();
  });
});

describe('fileLimits', () => {
  it('carries the curated limits it is given, and the defaults when given none', () => {
    expect(fileLimits(['.md'], { 'SOUL.md': 48000 }).curated).toEqual({
      'SOUL.md': 48000,
    });
    expect(fileLimits(['.md']).curated['SOUL.md']).toBe(
      DEFAULT_CURATED_LIMITS.soul,
    );
  });
});
