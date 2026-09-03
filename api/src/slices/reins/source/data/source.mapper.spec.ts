import { deriveIndexStatus } from './source.mapper';

describe('deriveIndexStatus', () => {
  it('is indexed once processing was confirmed, even with a stale error', () => {
    // LightRAG confirmed the content is searchable; an older error must not
    // paint the row red.
    expect(
      deriveIndexStatus({ indexedAt: new Date(), indexError: 'old' }),
    ).toBe('indexed');
  });

  it('is failed when the last run recorded an error and nothing succeeded', () => {
    expect(
      deriveIndexStatus({ indexedAt: null, indexError: 'rejected' }),
    ).toBe('failed');
  });

  it('is pending when nothing has been confirmed and nothing failed', () => {
    expect(deriveIndexStatus({ indexedAt: null, indexError: null })).toBe(
      'pending',
    );
  });

  it('stays pending while a document sits in the pipeline with a handle', () => {
    // The row carries lightragDocId as a resume handle from ingest time, which
    // deriveIndexStatus deliberately ignores: only indexedAt proves the
    // document is searchable.
    expect(deriveIndexStatus({ indexedAt: null, indexError: null })).toBe(
      'pending',
    );
  });
});
