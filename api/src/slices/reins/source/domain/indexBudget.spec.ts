import {
  indexBudgetMs,
  pollIntervalMs,
  staleIndexAfterMs,
} from './indexBudget';

const MINUTE = 60 * 1000;
const MB = 1024 * 1024;

// Array(n).fill(x) types as any[], which the lint rules reject on spread.
const sized = (count: number, bytes: number): number[] =>
  Array.from({ length: count }, () => bytes);

const docs = (...sizes: (number | null)[]): { sizeBytes: number | null }[] =>
  sizes.map((sizeBytes) => ({ sizeBytes }));

describe('indexBudgetMs', () => {
  it('gives a small document enough time without waiting for hours', () => {
    // 5 min base + 30 s for the document + ~0 for 3 KB of text.
    expect(indexBudgetMs(docs(3 * 1024))).toBeGreaterThan(5 * MINUTE);
    expect(indexBudgetMs(docs(3 * 1024))).toBeLessThan(6 * MINUTE);
  });

  it('scales with content volume, not just document count', () => {
    // The measurement this replaces: one 1 MB owner's manual is 217 chunks and
    // roughly 45 minutes of extraction plus merging. Counting documents gave
    // it 30 seconds.
    const oneBigFile = indexBudgetMs(docs(1 * MB));
    const manySmallFiles = indexBudgetMs(docs(...sized(20, 1024)));
    expect(oneBigFile).toBeGreaterThan(45 * MINUTE);
    expect(oneBigFile).toBeGreaterThan(manySmallFiles);
  });

  it('still pays a per-document cost, so many tiny files are not free', () => {
    expect(indexBudgetMs(docs(...sized(20, 1024)))).toBeGreaterThan(
      indexBudgetMs(docs(1024)),
    );
  });

  it('falls back to the per-document term when a size is unknown', () => {
    expect(indexBudgetMs(docs(null))).toBe(5 * MINUTE + 30 * 1000);
  });

  it('caps the wait so a runaway batch cannot block a run forever', () => {
    expect(indexBudgetMs(docs(...sized(500, 10 * MB)))).toBe(4 * 60 * MINUTE);
  });

  it('handles an empty batch and negative sizes without going negative', () => {
    expect(indexBudgetMs([])).toBe(5 * MINUTE);
    expect(indexBudgetMs(docs(-5))).toBe(5 * MINUTE + 30 * 1000);
  });
});

describe('staleIndexAfterMs', () => {
  it('always trails the run budget, so a restart is never offered mid-run', () => {
    const batches = [
      [],
      docs(1024),
      docs(1 * MB),
      docs(...sized(50, 512 * 1024)),
      docs(...sized(500, 10 * MB)),
    ];
    for (const batch of batches) {
      expect(staleIndexAfterMs(batch)).toBeGreaterThan(indexBudgetMs(batch));
    }
  });
});

describe('pollIntervalMs', () => {
  it('polls at the floor for a batch small enough not to matter', () => {
    expect(pollIntervalMs(0)).toBe(3000);
    expect(pollIntervalMs(1)).toBe(3000);
    expect(pollIntervalMs(30)).toBe(3000);
  });

  it('holds the request rate roughly flat as the batch grows', () => {
    // The point of the pacing: requests per second, not ticks per second.
    for (const inFlight of [50, 120, 355, 600]) {
      const ratePerSec = inFlight / (pollIntervalMs(inFlight) / 1000);
      expect(ratePerSec).toBeLessThanOrEqual(11);
    }
  });

  it('backs a 355-document run off from three seconds to tens of seconds', () => {
    // The batch that produced ~118 requests a second on prod.
    expect(pollIntervalMs(355)).toBeGreaterThan(30_000);
  });

  it('never waits longer than a minute, however large the batch', () => {
    expect(pollIntervalMs(10_000)).toBe(60_000);
  });

  it('speeds back up as documents land', () => {
    expect(pollIntervalMs(355)).toBeGreaterThan(pollIntervalMs(100));
    expect(pollIntervalMs(100)).toBeGreaterThan(pollIntervalMs(10));
  });
});
