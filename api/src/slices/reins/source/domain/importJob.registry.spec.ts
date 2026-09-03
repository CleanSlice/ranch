import { ImportJobRegistry } from './importJob.registry';

const HOUR_MS = 60 * 60 * 1000;

describe('ImportJobRegistry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-17T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accumulates counters and caps the recorded errors', () => {
    const registry = new ImportJobRegistry();
    const job = registry.create('k-1', 'archive', 30);

    registry.progress(job.id, { added: 5 });
    registry.progress(job.id, { added: 2, skipped: 1 });
    for (let i = 0; i < 25; i += 1) {
      registry.progress(job.id, { failed: 1, error: `f${i}: boom` });
    }

    const stored = registry.get(job.id);
    expect(stored).toMatchObject({
      status: 'running',
      detected: 30,
      added: 7,
      skipped: 1,
      failed: 25,
      finishedAt: null,
    });
    // The UI shows the first few reasons; the rest is only a count.
    expect(stored?.errors).toHaveLength(20);
    expect(stored?.errors[0]).toBe('f0: boom');
  });

  it('lists jobs of one knowledge oldest first', () => {
    const registry = new ImportJobRegistry();
    const first = registry.create('k-1', 'archive', 1);
    jest.setSystemTime(new Date('2026-08-17T10:00:01Z'));
    const second = registry.create('k-1', 'archive', 2);
    registry.create('k-2', 'archive', 3);

    expect(registry.listByKnowledge('k-1').map((j) => j.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('forgets finished jobs after an hour but keeps running ones', () => {
    const registry = new ImportJobRegistry();
    const done = registry.create('k-1', 'archive', 1);
    const running = registry.create('k-1', 'archive', 1);
    registry.finish(done.id, 'done');

    jest.setSystemTime(new Date(Date.now() + HOUR_MS + 1000));

    // Pruning happens on the next read/create, no timers to leak.
    expect(registry.listByKnowledge('k-1').map((j) => j.id)).toEqual([
      running.id,
    ]);
    expect(registry.get(done.id)).toBeNull();
  });

  it('records the terminal reason when an import crashes', () => {
    const registry = new ImportJobRegistry();
    const job = registry.create('k-1', 'archive', 4);

    registry.finish(job.id, 'failed', 'archive import crashed: disk full');

    expect(registry.get(job.id)).toMatchObject({
      status: 'failed',
      errors: ['archive import crashed: disk full'],
    });
    expect(registry.get(job.id)?.finishedAt).toBeInstanceOf(Date);
  });

  it('keeps the terminal reason even when the per-entry error cap is full', () => {
    const registry = new ImportJobRegistry();
    const job = registry.create('k-1', 'archive', 40);
    for (let i = 0; i < 30; i += 1) {
      registry.progress(job.id, { failed: 1, error: `f${i}: boom` });
    }

    registry.finish(job.id, 'failed', 'archive import crashed: disk full');

    const errors = registry.get(job.id)?.errors ?? [];
    expect(errors).toHaveLength(21);
    expect(errors.at(-1)).toBe('archive import crashed: disk full');
  });
});
