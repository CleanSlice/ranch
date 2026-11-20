import { describe, expect, test } from 'bun:test';
import { applyPatch, revertPatch } from './patchPeer';

interface IRow {
  id: string;
  openToVisitors: boolean;
  needsReview: boolean;
}

const rows = (): IRow[] => [
  { id: 'peer-1', openToVisitors: false, needsReview: true },
  { id: 'peer-2', openToVisitors: false, needsReview: false },
];

describe('the optimistic patch of a peer row', () => {
  test('moves the one row, and leaves the list alone when the id is not in it', () => {
    const patched = applyPatch(rows(), 'peer-1', { openToVisitors: true });
    expect(patched.map((r) => r.openToVisitors)).toEqual([true, false]);
    expect(applyPatch(rows(), 'nope', { openToVisitors: true })).toEqual(rows());
  });

  test('a refusal puts the switch back where it was', () => {
    const [before] = rows();
    const guess = { openToVisitors: true };
    const patched = applyPatch(rows(), 'peer-1', guess);

    expect(revertPatch(patched, before, guess)).toEqual(rows());
  });

  test('a fresher answer that landed in between is not overwritten by the rollback', () => {
    const [before] = rows();
    const guess = { openToVisitors: true };
    // The server's own row arrived while the request was out: closed again,
    // review mark cleared.
    const fresher = applyPatch(applyPatch(rows(), 'peer-1', guess), 'peer-1', {
      openToVisitors: false,
      needsReview: false,
    });

    expect(revertPatch(fresher, before, guess)[0]).toEqual({
      id: 'peer-1',
      openToVisitors: false,
      needsReview: false,
    });
  });
});
