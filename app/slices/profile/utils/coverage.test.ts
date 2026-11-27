import { describe, expect, test } from 'bun:test';
import { coverageNotes } from './coverage';

describe('coverageNotes', () => {
  test('says how many conversations are waiting for a summary', () => {
    expect(coverageNotes({ summarised: 8, waiting: 3, tooShort: 0 })).toEqual([
      { kind: 'waiting', count: 3 },
    ]);
  });

  // Not a backlog: a conversation under three messages gets no summary as it
  // stands, and is never said to be waiting.
  test('names the conversations too short for a summary apart, after the waiting ones', () => {
    expect(coverageNotes({ summarised: 8, waiting: 3, tooShort: 1 })).toEqual([
      { kind: 'waiting', count: 3 },
      { kind: 'too-short', count: 1 },
    ]);
    expect(coverageNotes({ summarised: 8, waiting: 0, tooShort: 2 })).toEqual([
      { kind: 'too-short', count: 2 },
    ]);
  });

  test('says that all are counted only when none is left out for either reason', () => {
    expect(coverageNotes({ summarised: 8, waiting: 0, tooShort: 0 })).toEqual([
      { kind: 'all-counted', count: null },
    ]);
  });

  // Over "no conversation has a summary yet" it would be a sentence about
  // nothing: the line is then not drawn.
  test('says nothing when nothing has a summary and nothing is left out', () => {
    expect(coverageNotes({ summarised: 0, waiting: 0, tooShort: 0 })).toEqual([]);
  });

  test('still names what is left out while nothing has a summary yet', () => {
    expect(coverageNotes({ summarised: 0, waiting: 4, tooShort: 1 })).toEqual([
      { kind: 'waiting', count: 4 },
      { kind: 'too-short', count: 1 },
    ]);
  });
});
