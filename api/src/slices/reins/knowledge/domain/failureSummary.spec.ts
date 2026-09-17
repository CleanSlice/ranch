import { FAILURE_SUMMARY_LIMIT, summarizeFailures } from './failureSummary';

function failures(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `doc-${i + 1}.pdf`,
    error: 'only whitespace',
    retryAt: null,
  }));
}

describe('summarizeFailures', () => {
  it('is null when nothing failed', () => {
    expect(summarizeFailures([])).toBeNull();
  });

  it('names every failure when there are few', () => {
    expect(summarizeFailures(failures(2))).toBe(
      '2 source(s) failed: doc-1.pdf (only whitespace); doc-2.pdf (only whitespace)',
    );
  });

  it('says how many more there are instead of trailing off', () => {
    const line = summarizeFailures(failures(17))!;
    expect(line.startsWith('17 source(s) failed: doc-1.pdf')).toBe(true);
    expect(line).toContain(`doc-${FAILURE_SUMMARY_LIMIT}.pdf`);
    expect(line).not.toContain(`doc-${FAILURE_SUMMARY_LIMIT + 1}.pdf`);
    expect(line.endsWith('; and 12 more, all listed under Sources > Failed')).toBe(true);
    expect(line).not.toContain('...');
  });

  it('falls back to a wording for a failure with no message', () => {
    expect(
      summarizeFailures([{ name: 'a.pdf', error: null, retryAt: null }]),
    ).toBe('1 source(s) failed: a.pdf (unknown error)');
  });

  it('says how many of them the reconciler will retry on its own', () => {
    const line = summarizeFailures([
      { name: 'a.pdf', error: 'RetryError[...]', retryAt: new Date() },
      { name: 'b.pdf', error: 'RetryError[...]', retryAt: new Date() },
      { name: 'c.pdf', error: 'only whitespace', retryAt: null },
    ])!;
    expect(line.startsWith('3 source(s) failed: a.pdf')).toBe(true);
    expect(line.endsWith('; 2 of them will be retried automatically')).toBe(true);
  });
});
