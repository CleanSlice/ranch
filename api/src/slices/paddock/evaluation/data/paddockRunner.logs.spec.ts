import { readFileSync } from 'fs';
import { join } from 'path';
import { BunCliPaddockRunner } from './paddockRunner';

/**
 * The log of a paddock run is kept per run, under its evaluation id
 * (CLEAN-271).
 *
 * It used to be one buffer per agent. A later run of the agent answered for
 * an earlier one, and the child of an earlier run, still writing, appended
 * to the buffer a later run had taken over: the lines of a run somebody may
 * not read turned up in the log of a run they may.
 */
describe('BunCliPaddockRunner — one log per run', () => {
  type Internals = {
    openLog(evaluationId: string): string[];
    appendLog(buf: string[], line: string): void;
  };
  const runner = () => {
    const made = new BunCliPaddockRunner();
    return { made, inner: made as unknown as Internals };
  };

  it('a second run of the same agent, started while the first child is still writing, receives none of its lines', () => {
    const { made, inner } = runner();
    // What `run` does when it spawns: the process is handed its buffer.
    const first = inner.openLog('evaluation-1');
    inner.appendLog(first, 'first: scenario one');
    const second = inner.openLog('evaluation-2');
    // The first child has not closed, and writes on.
    inner.appendLog(first, 'first: scenario two, late');
    inner.appendLog(second, 'second: scenario one');
    inner.appendLog(first, 'first: still writing');
    expect(made.getLogs('evaluation-2')).toEqual(['second: scenario one']);
    expect(made.getLogs('evaluation-1')).toEqual([
      'first: scenario one',
      'first: scenario two, late',
      'first: still writing',
    ]);
    expect(made.getLogs('agent-alpha')).toEqual([]);
    expect(made.getLogs('evaluation-nobody-has')).toEqual([]);
  });

  it('a run started again under the same id starts empty, and the earlier child no longer reaches it', () => {
    const { made, inner } = runner();
    const earlier = inner.openLog('evaluation-1');
    inner.appendLog(earlier, 'earlier');
    const again = inner.openLog('evaluation-1');
    inner.appendLog(earlier, 'earlier, late');
    inner.appendLog(again, 'again');
    expect(made.getLogs('evaluation-1')).toEqual(['again']);
  });

  it('the ring is bounded per run, in place, and the number of runs kept is bounded', () => {
    const { made, inner } = runner();
    const buf = inner.openLog('evaluation-1');
    for (let i = 0; i < 2100; i += 1) inner.appendLog(buf, `line ${i}`);
    // In place: the array the process holds is the one that is read.
    expect(made.getLogs('evaluation-1')).toBe(buf);
    expect(buf).toHaveLength(2000);
    expect(buf[buf.length - 1]).toBe('line 2099');
    for (let i = 2; i <= 30; i += 1) inner.openLog(`evaluation-${i}`);
    expect(made.getLogs('evaluation-1')).toEqual([]);
    expect(made.getLogs('evaluation-30')).toEqual([]);
    inner.appendLog(inner.openLog('evaluation-31'), 'kept');
    expect(made.getLogs('evaluation-31')).toEqual(['kept']);
  });

  it('the process of a run writes to the buffer it was given, never to one looked up by agent', () => {
    const source = readFileSync(join(__dirname, 'paddockRunner.ts'), 'utf8');
    expect(source).toContain('const log = this.openLog(input.evaluationId);');
    const appends = [...source.matchAll(/this\.appendLog\(([^,]+),/g)].map(
      (match) => match[1].trim(),
    );
    expect(appends.length).toBeGreaterThanOrEqual(3);
    expect(new Set(appends)).toEqual(new Set(['log']));
    expect(source).not.toMatch(/this\.logs\.(get|set)\(input\.agentId/);
    // And a run is over when its child has closed, not before.
    expect(source).toMatch(/proc\.on\('close'/);
  });
});
