import { detectLogLevel, parseLogLine, summarizeLogText } from './logLines';

/**
 * The counts the collapsed Logs bar shows are worked out here now (CLEAN-233),
 * so what the browser used to compute has to come out the same. The cases
 * below are the ones that made the old client-side version non-obvious: the
 * runtime's glyphs beat the substring heuristics, markers are a whole answer
 * rather than a line of log, and the trailing newline is not an entry.
 */
const TS = '2026-11-17T12:00:00.000Z';

describe('summarizeLogText', () => {
  it('counts the lines of the window and keeps the newest one raw', () => {
    const raw = `${TS} first\n${TS} second\n${TS} third\n`;

    const summary = summarizeLogText(raw);

    expect(summary.total).toBe(3);
    expect(summary.alerts).toBe(0);
    expect(summary.latest).toBe(`${TS} third`);
  });

  it('has nothing to say about an empty read', () => {
    expect(summarizeLogText('')).toEqual({ latest: null, total: 0, alerts: 0 });
    expect(summarizeLogText('\n')).toEqual({
      latest: null,
      total: 0,
      alerts: 0,
    });
  });

  it('counts warnings and errors, and only those', () => {
    const raw = [
      `${TS} 12:00:00.000 · started`,
      `${TS} 12:00:01.000 ⚠ disk is filling up`,
      `${TS} 12:00:02.000 ✗ upload failed`,
      `${TS} retrying after error in the upstream call`,
      '',
    ].join('\n');

    const summary = summarizeLogText(raw);

    expect(summary.total).toBe(4);
    // The fourth line is prose about an error, not an error line — the same
    // call the console makes, so the bar and the panel agree.
    expect(summary.alerts).toBe(2);
  });

  it('treats a backend marker as the one line it is', () => {
    const summary = summarizeLogText('[no pod yet for pending agent]');

    expect(summary.total).toBe(1);
    expect(summary.alerts).toBe(0);
    expect(summary.latest).toBe('[no pod yet for pending agent]');
  });
});

describe('parseLogLine', () => {
  it('splits the K8s timestamp off and drops the runtime time prefix', () => {
    const parts = parseLogLine(`${TS} 12:00:00.000 · hello`);

    expect(parts.at?.toISOString()).toBe(TS);
    expect(parts.text).toBe('· hello');
  });

  it('keeps the whole line when there is no timestamp to split off', () => {
    const parts = parseLogLine('[container containercreating]');

    expect(parts.at).toBeNull();
    expect(parts.text).toBe('[container containercreating]');
  });
});

describe('detectLogLevel', () => {
  it('lets the runtime glyph overrule a quoted payload', () => {
    expect(detectLogLevel('⚠ peer said {"error":"Not Found"}')).toBe('warn');
  });

  it('reads an uppercase level token, and leaves prose alone', () => {
    expect(detectLogLevel('ERROR could not connect')).toBe('error');
    expect(detectLogLevel('WARNING slow response')).toBe('warn');
    expect(detectLogLevel('wrote STDERRORS to the log')).toBeNull();
  });
});
