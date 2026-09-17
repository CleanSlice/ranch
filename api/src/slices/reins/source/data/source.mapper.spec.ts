import { deriveIndexStatus } from './source.mapper';

describe('deriveIndexStatus', () => {
  it('is indexed once processing was confirmed, even with a stale error', () => {
    // LightRAG confirmed the content is searchable; an older error must not
    // paint the row red, and a leftover retry slot means nothing either.
    expect(
      deriveIndexStatus({
        indexedAt: new Date(),
        indexError: 'old',
        indexRetryAt: new Date(),
      }),
    ).toBe('indexed');
  });

  it('is failed when the last run recorded an error and nothing will retry it', () => {
    expect(
      deriveIndexStatus({
        indexedAt: null,
        indexError: 'rejected',
        indexRetryAt: null,
      }),
    ).toBe('failed');
  });

  it('is retrying while the reconciler still owes the row another attempt', () => {
    // Failed, yes, but for a reason that passes; showing that as a plain
    // failure is what sent people to re-upload documents that were about to
    // recover on their own.
    expect(
      deriveIndexStatus({
        indexedAt: null,
        indexError: 'RetryError[...]',
        indexRetryAt: new Date(),
      }),
    ).toBe('retrying');
  });

  it('is pending when nothing has been confirmed and nothing failed', () => {
    expect(
      deriveIndexStatus({
        indexedAt: null,
        indexError: null,
        indexRetryAt: null,
      }),
    ).toBe('pending');
  });

  it('stays pending while a document sits in the pipeline with a handle', () => {
    // The row carries lightragDocId as a resume handle from ingest time, which
    // deriveIndexStatus deliberately ignores: only indexedAt proves the
    // document is searchable.
    expect(
      deriveIndexStatus({
        indexedAt: null,
        indexError: null,
        indexRetryAt: null,
      }),
    ).toBe('pending');
  });
});
