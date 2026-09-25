import { describe, expect, test } from 'bun:test';
import { parseAgentLogs, summarizeAgentLogs } from './agentLogs';

// Two calendar days so parseAgentLogs yields two groups; the last line of the
// second group is the one the collapsed Logs bar shows.
const RAW = [
  '2026-09-20T21:45:40.100Z · booting',
  '2026-09-20T21:45:41.200Z ⚠ warn  retrying bridle hub',
  '2026-09-25T09:01:02.300Z · connected',
  '2026-09-25T09:01:03.400Z ✗ error boom',
  '2026-09-25T09:01:04.500Z · s3 flushed 1 changed files',
].join('\n');

describe('summarizeAgentLogs', () => {
  test('an empty log has no latest line and zero counts', () => {
    expect(summarizeAgentLogs([])).toEqual({
      latest: null,
      total: 0,
      alerts: 0,
    });
  });

  test('counts every line across groups and picks the last one as latest', () => {
    const groups = parseAgentLogs(RAW);
    expect(groups.length).toBe(2);
    const summary = summarizeAgentLogs(groups);
    expect(summary.total).toBe(5);
    // The runtime's level glyph stays in the text; only the duplicate time
    // prefix is stripped by the parser.
    expect(summary.latest?.text).toBe('· s3 flushed 1 changed files');
    expect(/^\d{2}:\d{2}:\d{2}\.500$/.test(summary.latest?.time ?? '')).toBe(
      true,
    );
    expect(summary.latest?.level).toBe(null);
  });

  test('alerts counts warn and error lines, not plain ones', () => {
    const summary = summarizeAgentLogs(parseAgentLogs(RAW));
    expect(summary.alerts).toBe(2);
  });

  test('a single undated marker line is still a latest line', () => {
    const summary = summarizeAgentLogs(parseAgentLogs('plain line'));
    expect(summary.total).toBe(1);
    expect(summary.latest?.time).toBe(null);
    expect(summary.latest?.text).toBe('plain line');
  });
});
