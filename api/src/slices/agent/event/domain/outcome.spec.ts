import { decideDisposition } from './outcome';

const outside = (status: 'failed' | 'recovered', ranchStatus: string | null) =>
  decideDisposition({
    status,
    witness: 'external',
    agentFound: ranchStatus !== null,
    ranchStatus,
  });

describe('decideDisposition', () => {
  it('an id that matches no agent is stored as unmatched', () => {
    expect(outside('failed', null)).toBe('unmatched');
    expect(outside('recovered', null)).toBe('unmatched');
  });

  it('a recovered report is evidence, whatever Ranch holds', () => {
    for (const s of ['running', 'failed', 'unreachable', 'stopped', 'deploying']) {
      expect(outside('recovered', s)).toBe('evidence');
    }
  });

  it('an outside failure for an agent a person stopped is suppressed', () => {
    expect(outside('failed', 'stopped')).toBe('suppressed_stopped');
  });

  it('an outside failure during a start or a restart is suppressed', () => {
    expect(outside('failed', 'pending')).toBe('suppressed_starting');
    expect(outside('failed', 'deploying')).toBe('suppressed_starting');
  });

  it('an outside failure for a running, unreachable or failed agent goes to an incident', () => {
    expect(outside('failed', 'running')).toBe('incident');
    expect(outside('failed', 'unreachable')).toBe('incident');
    expect(outside('failed', 'failed')).toBe('incident');
  });

  it("Ranch's own failure always goes to an incident", () => {
    for (const status of ['failed', 'unreachable'] as const) {
      expect(
        decideDisposition({
          status,
          witness: 'ranch',
          agentFound: true,
          ranchStatus: status,
        }),
      ).toBe('incident');
    }
  });
});
