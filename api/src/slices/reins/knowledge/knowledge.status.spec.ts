import { deriveIndexStatus } from './domain/knowledge.status';

describe('deriveIndexStatus — the base-level rollup is derived, never asserted', () => {
  test('no sources → empty (a base with nothing cannot claim readiness)', () => {
    expect(deriveIndexStatus([])).toBe('empty');
  });

  test('any source processing → indexing, regardless of the rest', () => {
    expect(deriveIndexStatus(['indexed', 'processing', 'failed'])).toBe(
      'indexing',
    );
    expect(deriveIndexStatus(['processing'])).toBe('indexing');
  });

  test('ready only when at least one source exists and every source is indexed', () => {
    expect(deriveIndexStatus(['indexed'])).toBe('ready');
    expect(deriveIndexStatus(['indexed', 'indexed'])).toBe('ready');
  });

  test('failed or queued sources keep the base partial, not ready and not failed-as-a-whole', () => {
    expect(deriveIndexStatus(['indexed', 'failed'])).toBe('partial');
    expect(deriveIndexStatus(['indexed', 'queued'])).toBe('partial');
    expect(deriveIndexStatus(['failed'])).toBe('partial');
    expect(deriveIndexStatus(['queued'])).toBe('partial');
  });
});
