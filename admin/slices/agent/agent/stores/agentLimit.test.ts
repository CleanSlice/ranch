import { describe, expect, test } from 'bun:test';
import type {
  IAgentLimitSummary,
  IAgentLimits,
  IAgentLoad,
} from '#agent/domain/agentLimit.types';
import type { AgentLimitService } from '#agent/domain/agentLimit.service';
import type { IPollerEnv } from '#agent/utils/visiblePoller';
import { agentLimitStoreSetup } from './agentLimit';

// The store's setup function is exercised directly, with a hand-made service
// and a hand-made browser: no Nuxt app, no Pinia instance, no real timers.

const LIMITS: IAgentLimits = { perMinute: 20, perHour: 300, perDay: null };

function load(over: Partial<IAgentLoad> = {}): IAgentLoad {
  return {
    limits: LIMITS,
    isPublic: true,
    needsLimits: false,
    windows: [
      { window: 'minute', used: 3, limit: 20, retryAfterSec: null },
      { window: 'hour', used: 40, limit: 300, retryAfterSec: null },
      { window: 'day', used: 90, limit: null, retryAfterSec: null },
    ],
    inFlight: 1,
    series: [],
    refused: { lastHour: 0, lastAt: null, byWindow: { minute: 0, hour: 0, day: 0 } },
    exemptLastHour: 2,
    peaks: { minute: 12, hour: 140, day: 900 },
    apiReplicas: 1,
    ...over,
  };
}

interface IFake {
  service: AgentLimitService;
  calls: string[];
  summaryRows: IAgentLimitSummary[];
  limitsNow: IAgentLimits | null;
  loadNow: IAgentLoad;
  /** When set, `setLimits` rejects with it. */
  refuse: unknown;
}

function fakeService(): IFake {
  const fake: IFake = {
    calls: [],
    summaryRows: [],
    limitsNow: null,
    loadNow: load(),
    refuse: null,
    service: null as unknown as AgentLimitService,
  };
  fake.service = {
    summary: async () => {
      fake.calls.push('summary');
      return fake.summaryRows;
    },
    limits: async (id: string) => {
      fake.calls.push(`limits:${id}`);
      return fake.limitsNow;
    },
    setLimits: async (id: string, limits: IAgentLimits | null) => {
      fake.calls.push(`set:${id}`);
      if (fake.refuse) throw fake.refuse;
      fake.limitsNow = limits;
      return limits;
    },
    load: async (id: string) => {
      fake.calls.push(`load:${id}`);
      return fake.loadNow;
    },
  } as unknown as AgentLimitService;
  return fake;
}

/** A browser with a clock the test turns by hand. */
function fakeEnv() {
  const state = {
    hidden: false,
    listeners: [] as Array<() => void>,
    timers: [] as Array<{ id: number; run: () => void; ms: number }>,
    nextId: 1,
  };
  const env: IPollerEnv = {
    isHidden: () => state.hidden,
    onVisibilityChange(listener) {
      state.listeners.push(listener);
      return () => {
        state.listeners = state.listeners.filter((l) => l !== listener);
      };
    },
    setInterval(run, ms) {
      const id = state.nextId++;
      state.timers.push({ id, run, ms });
      return id;
    },
    clearInterval(handle) {
      state.timers = state.timers.filter((t) => t.id !== handle);
    },
  };
  return {
    env,
    state,
    setHidden(hidden: boolean) {
      state.hidden = hidden;
      const listeners = [...state.listeners];
      for (let i = 0; i < listeners.length; i += 1) listeners[i]!();
    },
    /** Fire every running timer once. */
    tick() {
      const timers = [...state.timers];
      for (let i = 0; i < timers.length; i += 1) timers[i]!.run();
    },
  };
}

/** Let the promises a poll started settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('agentLimit store — summary', () => {
  test('upserts one record per agent id', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.summaryRows = [
      { agentId: 'a', enabled: true, atLimit: false, needsLimits: false },
      { agentId: 'b', enabled: false, atLimit: false, needsLimits: true },
    ];

    await store.fetchSummary();

    expect(Object.keys(store.byAgent.value)).toEqual(['a', 'b']);
    expect(store.byAgent.value.a).toEqual({ enabled: true, atLimit: false, needsLimits: false });
    expect(store.byAgent.value.b).toEqual({ enabled: false, atLimit: false, needsLimits: true });
  });

  test('a second summary changes the flags and keeps what else is known', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.summaryRows = [{ agentId: 'a', enabled: true, atLimit: false, needsLimits: false }];
    await store.fetchSummary();
    await store.fetchLoad('a');

    fake.summaryRows = [{ agentId: 'a', enabled: true, atLimit: true, needsLimits: false }];
    await store.fetchSummary();

    expect(Object.keys(store.byAgent.value)).toEqual(['a']);
    expect(store.byAgent.value.a!.atLimit).toBe(true);
    expect(store.byAgent.value.a!.limits).toEqual(LIMITS);
    expect(store.byAgent.value.a!.load!.peaks).toEqual({ minute: 12, hour: 140, day: 900 });
  });

});

describe('agentLimit store — limits and load', () => {
  test('fetchLimits stores the limits, and null when they are off', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);

    fake.limitsNow = LIMITS;
    await store.fetchLimits('a');
    expect(store.byAgent.value.a!.limits).toEqual(LIMITS);
    expect(store.byAgent.value.a!.enabled).toBe(true);

    fake.limitsNow = null;
    await store.fetchLimits('a');
    expect(store.byAgent.value.a!.limits).toBe(null);
    expect(store.byAgent.value.a!.enabled).toBe(false);
  });

  test('fetchLoad writes the snapshot and the flags it implies into the same record', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.loadNow = load({
      windows: [
        { window: 'minute', used: 3, limit: 20, retryAfterSec: null },
        { window: 'hour', used: 300, limit: 300, retryAfterSec: 840 },
        { window: 'day', used: 400, limit: null, retryAfterSec: null },
      ],
    });

    await store.fetchLoad('a');

    const entry = store.byAgent.value.a!;
    expect(entry.load!.inFlight).toBe(1);
    expect(entry.limits).toEqual(LIMITS);
    expect(entry.enabled).toBe(true);
    expect(entry.atLimit).toBe(true);
    expect(entry.needsLimits).toBe(false);
  });

  test('a load with limits off keeps the load and says the limits are off', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.loadNow = load({ limits: null, needsLimits: true });

    await store.fetchLoad('a');

    const entry = store.byAgent.value.a!;
    expect(entry.limits).toBe(null);
    expect(entry.enabled).toBe(false);
    expect(entry.atLimit).toBe(false);
    expect(entry.needsLimits).toBe(true);
    expect(entry.load!.peaks.hour).toBe(140);
  });
});

describe('agentLimit store — save', () => {
  test('patches optimistically before the server answers', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.summaryRows = [{ agentId: 'a', enabled: false, atLimit: false, needsLimits: true }];
    await store.fetchSummary();

    let duringRequest: unknown = null;
    const result = await store.save('a', LIMITS, async () => {
      duringRequest = { ...store.byAgent.value.a };
      // The server now holds what was sent, and no longer nags.
      fake.limitsNow = LIMITS;
      fake.summaryRows = [{ agentId: 'a', enabled: true, atLimit: false, needsLimits: false }];
    });

    expect(duringRequest).toEqual({
      enabled: true,
      atLimit: false,
      needsLimits: false,
      limits: LIMITS,
    });
    expect(result).toEqual({ ok: true });
    // Read back from the server afterwards, not left as the guess.
    expect(fake.calls).toEqual(['summary', 'limits:a', 'summary']);
    expect(store.byAgent.value.a!.limits).toEqual(LIMITS);
  });

  test('saves through the limits route when no request is handed in', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);

    const result = await store.save('a', LIMITS);

    expect(result).toEqual({ ok: true });
    expect(fake.calls[0]).toBe('set:a');
    expect(store.byAgent.value.a!.limits).toEqual(LIMITS);
    expect(store.byAgent.value.a!.enabled).toBe(true);
  });

  test('rolls back on a refusal and hands back its code', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.limitsNow = LIMITS;
    fake.summaryRows = [{ agentId: 'a', enabled: true, atLimit: false, needsLimits: false }];
    await store.fetchSummary();
    await store.fetchLimits('a');

    fake.refuse = refusal(
      'PUBLIC_AGENT_NEEDS_LIMITS',
      'A public agent needs at least one request limit.',
    );
    const result = await store.save('a', null);

    expect(result).toEqual({
      ok: false,
      code: 'PUBLIC_AGENT_NEEDS_LIMITS',
      message: 'A public agent needs at least one request limit.',
    });
    expect(store.byAgent.value.a).toEqual({
      enabled: true,
      atLimit: false,
      needsLimits: false,
      limits: LIMITS,
    });
  });

  test('rolls back when the request handed in is refused', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    await store.fetchLimits('a');

    const result = await store.save('a', { perMinute: 20, perHour: 10, perDay: null }, async () => {
      throw refusal('LIMIT_WINDOWS_CONTRADICT', 'The limit per hour (10) is lower.');
    });

    expect(result).toEqual({
      ok: false,
      code: 'LIMIT_WINDOWS_CONTRADICT',
      message: 'The limit per hour (10) is lower.',
    });
    expect(store.byAgent.value.a!.limits).toBe(null);
    expect(store.byAgent.value.a!.enabled).toBe(false);
  });

  test('a failure with no code is still a failure, with a null code', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    fake.refuse = new Error('Saving limits failed: could not reach the API.');

    const result = await store.save('a', LIMITS);

    expect(result).toEqual({
      ok: false,
      code: null,
      message: 'Saving limits failed: could not reach the API.',
    });
    expect(store.byAgent.value.a!.limits).toBe(undefined);
  });

  test('the rollback leaves a fresher server value alone', async () => {
    const fake = fakeService();
    const store = agentLimitStoreSetup(() => fake.service, fakeEnv().env);
    const fresher: IAgentLimits = { perMinute: 5, perHour: null, perDay: null };

    await store.save('a', LIMITS, async () => {
      // A poll lands while the save is in flight and brings what the server holds.
      store.upsert('a', { limits: fresher, enabled: true });
      throw refusal('LIMIT_OUT_OF_RANGE', 'no');
    });

    expect(store.byAgent.value.a!.limits).toEqual(fresher);
  });
});

describe('agentLimit store — polls', () => {
  test('the load poll asks at once, every 3 s, and stops when released', async () => {
    const fake = fakeService();
    const browser = fakeEnv();
    const store = agentLimitStoreSetup(() => fake.service, browser.env);

    const stop = store.watchLoad('a');
    await settle();
    expect(fake.calls).toEqual(['load:a']);
    expect(browser.state.timers.map((t) => t.ms)).toEqual([3000]);

    browser.tick();
    await settle();
    expect(fake.calls).toEqual(['load:a', 'load:a']);

    stop();
    expect(browser.state.timers.length).toBe(0);
    expect(browser.state.listeners.length).toBe(0);
  });

  test('the summary poll runs every 15 s', async () => {
    const fake = fakeService();
    const browser = fakeEnv();
    const store = agentLimitStoreSetup(() => fake.service, browser.env);

    const stop = store.watchSummary();
    await settle();

    expect(fake.calls).toEqual(['summary']);
    expect(browser.state.timers.map((t) => t.ms)).toEqual([15000]);
    stop();
    expect(browser.state.timers.length).toBe(0);
  });

  test('a hidden tab stops asking and a visible one asks again at once', async () => {
    const fake = fakeService();
    const browser = fakeEnv();
    const store = agentLimitStoreSetup(() => fake.service, browser.env);
    const stop = store.watchLoad('a');
    await settle();

    browser.setHidden(true);
    expect(browser.state.timers.length).toBe(0);
    browser.tick();
    await settle();
    expect(fake.calls).toEqual(['load:a']);

    browser.setHidden(false);
    await settle();
    expect(fake.calls).toEqual(['load:a', 'load:a']);
    expect(browser.state.timers.length).toBe(1);
    stop();
  });

  test('a poll started in a hidden tab waits until the tab is shown', async () => {
    const fake = fakeService();
    const browser = fakeEnv();
    browser.state.hidden = true;
    const store = agentLimitStoreSetup(() => fake.service, browser.env);

    const stop = store.watchSummary();
    await settle();
    expect(fake.calls).toEqual([]);

    browser.setHidden(false);
    await settle();
    expect(fake.calls).toEqual(['summary']);
    stop();
  });

  test('two watchers of one agent share one poll, and the last one out ends it', async () => {
    const fake = fakeService();
    const browser = fakeEnv();
    const store = agentLimitStoreSetup(() => fake.service, browser.env);

    const stopFirst = store.watchLoad('a');
    const stopSecond = store.watchLoad('a');
    await settle();
    expect(browser.state.timers.length).toBe(1);
    expect(fake.calls).toEqual(['load:a']);

    stopFirst();
    stopFirst();
    expect(browser.state.timers.length).toBe(1);
    stopSecond();
    expect(browser.state.timers.length).toBe(0);
  });

  test('a failing poll keeps the last figures and keeps polling', async () => {
    const fake = fakeService();
    const browser = fakeEnv();
    const store = agentLimitStoreSetup(() => fake.service, browser.env);
    const stop = store.watchLoad('a');
    await settle();

    (fake.service as unknown as { load: () => Promise<IAgentLoad> }).load = async () => {
      fake.calls.push('load:failed');
      throw new Error('down');
    };
    browser.tick();
    await settle();

    expect(fake.calls).toEqual(['load:a', 'load:failed']);
    expect(store.byAgent.value.a!.load!.inFlight).toBe(1);
    expect(browser.state.timers.length).toBe(1);
    stop();
  });
});
