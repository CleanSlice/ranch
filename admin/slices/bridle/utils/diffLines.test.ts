import { describe, expect, test } from 'bun:test';
import { countRows, parseUnifiedDiff } from './diffLines';

const patch = [
  '===================================================================',
  '--- agent.config.json\tstored',
  '+++ agent.config.json\tproposed',
  '@@ -10,5 +10,5 @@',
  '   "heartbeat": {',
  '-    "intervalMin": 30',
  '+    "intervalMin": 45',
  '   },',
  '',
].join('\n');

describe('parseUnifiedDiff', () => {
  test('turns hunks into gutter-numbered rows and skips file headers', () => {
    const rows = parseUnifiedDiff(patch);
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'context', 'remove', 'add', 'context']);
    expect(rows[1]).toEqual({ kind: 'context', line: 10, text: '  "heartbeat": {' });
    expect(rows[2]).toEqual({ kind: 'remove', line: 11, text: '    "intervalMin": 30' });
    expect(rows[3]).toEqual({ kind: 'add', line: 11, text: '    "intervalMin": 45' });
    expect(rows[4]).toEqual({ kind: 'context', line: 12, text: '  },' });
  });

  test('counts additions and deletions', () => {
    expect(countRows(parseUnifiedDiff(patch))).toEqual({ additions: 1, deletions: 1 });
  });

  test('ignores the no-newline marker and returns nothing for an empty patch', () => {
    const rows = parseUnifiedDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n');
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'remove', 'add']);
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
