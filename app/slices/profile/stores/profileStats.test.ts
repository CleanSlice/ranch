// The profile's statistics store (CLEAN-258): one view per `scope:period`,
// fetched again only once it is stale, and the guards that keep a failure and
// a late answer from taking what is on screen. The store itself runs here, as
// in chat.test.ts: what Nuxt would auto-import is put on `globalThis` first,
// and the store is loaded after. The gateway is the fake; the service is real.

import { describe, expect, test as bunTest } from 'bun:test';
import { computed, markRaw, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

import type { IStatsGateway } from '../domain/stats.gateway';
import { ProfileStatsService } from '../domain/stats.service';
import {
  StatsForbiddenError,
  type IInstallationStats,
  type IPersonalStats,
} from '../domain/stats.types';
import type { StatsPeriod } from '../utils/statsView';

const T0 = new Date('2026-11-27T10:00:00.000Z');

/** A view that can be told apart by its conversation count. */
function stats(period: StatsPeriod, conversations: number): IPersonalStats {
  return {
    period,
    timeZone: 'Europe/Kyiv',
    range: {
      from: new Date('2026-10-29T00:00:00.000Z'),
      to: T0,
      previousFrom: new Date('2026-09-29T00:00:00.000Z'),
    },
    notes: [],
    // Summaries off, as on an installation that produces none: every part
    // read from them is zero or empty.
    summaries: { enabled: false, topicsReady: false, summarised: 0, waiting: 0, tooShort: 0 },
    board: {
      conversations: { value: conversations, previous: 0 },
      messages: { value: conversations * 3, previous: 0 },
      agents: { value: 1, reachable: 2 },
      resolved: { resolved: 0, summarised: 0 },
    },
    activity: { days: [], weekdays: [0, 0, 0, 0, 0, 0, 0], activeDays: 0 },
    agents: [],
    topics: [],
    outcome: {
      resolved: 0,
      open: 0,
      unknown: 0,
      notSummarised: 0,
      sentiment: { positive: 0, neutral: 0, mixed: 0, negative: 0 },
      languages: [],
    },
    openQuestions: { items: [], more: 0 },
    help: {
      cited: { conversations: 0, sources: [] },
      handovers: { total: 0, answered: 0, topPeer: null },
      ratings: { up: 0, down: 0 },
    },
    models: { items: [], fallback: false },
  };
}

/** An installation view that can be told apart by its model calls. */
function installation(period: StatsPeriod, modelCalls: number): IInstallationStats {
  return {
    period,
    range: {
      from: new Date('2026-10-29T00:00:00.000Z'),
      to: T0,
      previousFrom: new Date('2026-09-29T00:00:00.000Z'),
    },
    reach: { limited: false, agents: 3, ownerOnly: [] },
    notes: [],
    summaries: { enabled: false },
    board: {
      tokens: { input: modelCalls * 1000, output: modelCalls * 100 },
      calls: { value: modelCalls, previous: 0 },
      cost: { value: 0, previous: 0, unpriced: [] },
      people: { value: 1, previous: 0 },
    },
    daily: [],
    models: [],
    agents: [],
    projection30d: 0,
    health: { incidents: [], incidentsTotal: 0, refusals: [] },
    quality: [],
    channels: [],
  };
}

/** What the server would count now. */
let served = 1;
let calls: { period: StatsPeriod; timeZone: string }[] = [];
/** The periods the installation was asked for, in order. */
let installationCalls: StatsPeriod[] = [];
/** When set, answers wait for it. */
let gate: Promise<void> | null = null;
let failing = false;
/** The route refuses the caller, as it does a User. */
let forbidden = false;

const gateway: IStatsGateway = {
  async getMine(period, timeZone) {
    calls.push({ period, timeZone });
    // The answer is decided when the request is made, as on a server.
    const answer = stats(period, served);
    const fail = failing;
    if (gate) await gate;
    if (fail) throw new Error('offline');
    return answer;
  },
  async getInstallation(period) {
    installationCalls.push(period);
    const answer = installation(period, served);
    const fail = failing;
    const refused = forbidden;
    if (gate) await gate;
    if (refused) throw new StatsForbiddenError('Forbidden resource');
    if (fail) throw new Error('offline');
    return answer;
  },
};

Object.assign(globalThis, {
  ref,
  computed,
  markRaw,
  defineStore,
  useNuxtApp: () => ({ $profileStatsService: new ProfileStatsService(gateway) }),
});

const { useProfileStatsStore, STALE_MS } = await import('./profileStats');

/** A gate and the function that opens it. */
function hold(): () => void {
  let open!: () => void;
  gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    gate = null;
    open();
  };
}

// The store reads the time through `Date.now()`. A test puts its own clock
// there and takes it away again when it ends, pass or fail: the other test
// files run in this same process.
const realNow = Date.now;
let clock = T0.getTime();

/** Move the clock on from the start of the test. */
function at(ms: number) {
  clock = T0.getTime() + ms;
}

/** Every test starts at T0 with a store of its own. */
const test = (name: string, body: () => Promise<void>) =>
  bunTest(name, async () => {
    setActivePinia(createPinia());
    served = 1;
    calls = [];
    installationCalls = [];
    gate = null;
    failing = false;
    forbidden = false;
    at(0);
    Date.now = () => clock;
    try {
      await body();
    } finally {
      Date.now = realNow;
    }
  });

describe('load', () => {
  test('fetches the view and keeps it under its scope and period', async () => {
    const store = useProfileStatsStore();
    expect(store.statusFor('mine', 30)).toBe('idle');
    expect(store.viewFor('mine', 30)).toBe(null);

    await store.load('mine', 30, 'Europe/Kyiv');

    expect(calls).toEqual([{ period: 30, timeZone: 'Europe/Kyiv' }]);
    expect(Object.keys(store.views)).toEqual(['mine:30']);
    expect(store.statusFor('mine', 30)).toBe('ready');
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
    expect(store.views['mine:30']!.loadedAt).toBe(T0.getTime());
    // Another period is another view, and not known yet.
    expect(store.viewFor('mine', 7)).toBe(null);
    expect(store.statusFor('mine', 7)).toBe('idle');
  });

  test('says "loading" while the first answer is on its way', async () => {
    const store = useProfileStatsStore();
    const open = hold();
    const first = store.load('mine', 30, 'UTC');

    expect(store.statusFor('mine', 30)).toBe('loading');
    expect(store.viewFor('mine', 30)).toBe(null);

    open();
    await first;
    expect(store.statusFor('mine', 30)).toBe('ready');
  });

  test('a view younger than a minute is not fetched again', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 30, 'UTC');
    served = 2;
    at(STALE_MS - 1);

    await store.load('mine', 30, 'UTC');

    expect(calls.length).toBe(1);
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
  });

  test('an older one is fetched again, and the held one stays until the answer', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 30, 'UTC');
    served = 2;
    at(STALE_MS);
    const open = hold();

    const again = store.load('mine', 30, 'UTC');

    expect(calls.length).toBe(2);
    expect(store.statusFor('mine', 30)).toBe('loading');
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);

    open();
    await again;
    expect(store.statusFor('mine', 30)).toBe('ready');
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(2);
    expect(store.views['mine:30']!.loadedAt).toBe(T0.getTime() + STALE_MS);
  });

  test('each period has its own view and its own age', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 30, 'UTC');
    served = 5;
    await store.load('mine', 7, 'UTC');

    expect(calls.map((c) => c.period)).toEqual([30, 7]);
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
    expect(store.viewFor('mine', 7)!.board.conversations.value).toBe(5);
  });

  test('two loads of one view at the same moment are one request', async () => {
    const store = useProfileStatsStore();
    const open = hold();
    const first = store.load('mine', 30, 'UTC');
    const second = store.load('mine', 30, 'UTC');
    open();
    await Promise.all([first, second]);

    expect(calls.length).toBe(1);
    expect(store.statusFor('mine', 30)).toBe('ready');
  });
});

describe('a failed fetch', () => {
  test('is a status, not an exception, and holds nothing on a first load', async () => {
    const store = useProfileStatsStore();
    failing = true;

    await store.load('mine', 30, 'UTC');

    expect(store.statusFor('mine', 30)).toBe('failed');
    expect(store.viewFor('mine', 30)).toBe(null);
    expect(store.views['mine:30']!.loadedAt).toBe(null);
  });

  test('keeps the view that was held', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 30, 'UTC');
    at(STALE_MS);
    failing = true;

    await store.load('mine', 30, 'UTC');

    expect(store.statusFor('mine', 30)).toBe('failed');
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
    // Its age is still that of the answer it holds.
    expect(store.views['mine:30']!.loadedAt).toBe(T0.getTime());
  });

  test('is asked again by the next load, however soon', async () => {
    const store = useProfileStatsStore();
    failing = true;
    await store.load('mine', 30, 'UTC');
    failing = false;
    at(1);

    await store.load('mine', 30, 'UTC');

    expect(calls.length).toBe(2);
    expect(store.statusFor('mine', 30)).toBe('ready');
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
  });
});

describe('resetForAccount', () => {
  test('empties every view, and drops an answer that was on its way', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 7, 'UTC');
    const open = hold();
    const late = store.load('mine', 30, 'UTC');

    store.resetForAccount();
    open();
    await late;

    expect(store.views).toEqual({});
    expect(store.viewFor('mine', 7)).toBe(null);
    expect(store.viewFor('mine', 30)).toBe(null);
    expect(store.statusFor('mine', 30)).toBe('idle');
  });

  test('a failure that arrives after it is dropped as well', async () => {
    const store = useProfileStatsStore();
    failing = true;
    const open = hold();
    const late = store.load('mine', 30, 'UTC');

    store.resetForAccount();
    open();
    await late;

    expect(store.views).toEqual({});
  });

  test('the next account starts with a request of its own', async () => {
    const store = useProfileStatsStore();
    const open = hold();
    const late = store.load('mine', 30, 'UTC');
    store.resetForAccount();
    served = 9;

    // The previous account's request is still open: it must not be reused.
    const mine = store.load('mine', 30, 'UTC');
    open();
    await Promise.all([late, mine]);

    expect(calls.length).toBe(2);
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(9);
  });
});

describe('the installation scope', () => {
  test('is fetched by its own route and kept beside the personal view', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 30, 'Europe/Kyiv');
    served = 7;

    await store.load('installation', 30, 'Europe/Kyiv');

    // Its days are UTC days for everyone: the viewer's zone is not sent.
    expect(installationCalls).toEqual([30]);
    expect(calls.length).toBe(1);
    expect(Object.keys(store.views).sort()).toEqual(['installation:30', 'mine:30']);
    expect(store.statusFor('installation', 30)).toBe('ready');
    expect(store.viewFor('installation', 30)!.board.calls.value).toBe(7);
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
  });

  test('follows the same rules of age as the personal one', async () => {
    const store = useProfileStatsStore();
    await store.load('installation', 7, 'UTC');
    served = 2;
    at(STALE_MS - 1);
    await store.load('installation', 7, 'UTC');
    expect(installationCalls.length).toBe(1);

    at(STALE_MS);
    await store.load('installation', 7, 'UTC');
    expect(installationCalls.length).toBe(2);
    expect(store.viewFor('installation', 7)!.board.calls.value).toBe(2);
  });

  test('a failure keeps the view that was held', async () => {
    const store = useProfileStatsStore();
    await store.load('installation', 30, 'UTC');
    at(STALE_MS);
    failing = true;

    await store.load('installation', 30, 'UTC');

    expect(store.statusFor('installation', 30)).toBe('failed');
    expect(store.viewFor('installation', 30)!.board.calls.value).toBe(1);
  });
});

describe('a refusal (403)', () => {
  test('leaves no view and says so in the status', async () => {
    const store = useProfileStatsStore();
    forbidden = true;

    await store.load('installation', 30, 'UTC');

    expect(store.statusFor('installation', 30)).toBe('forbidden');
    expect(store.viewFor('installation', 30)).toBe(null);
    expect(store.views['installation:30']!.loadedAt).toBe(null);
  });

  test('takes away every installation view that was held, and no personal one', async () => {
    const store = useProfileStatsStore();
    await store.load('mine', 30, 'UTC');
    await store.load('installation', 30, 'UTC');
    await store.load('installation', 7, 'UTC');
    // The role was taken away while the page stood open.
    forbidden = true;
    at(STALE_MS);

    await store.load('installation', 30, 'UTC');

    expect(store.statusFor('installation', 30)).toBe('forbidden');
    expect(store.viewFor('installation', 30)).toBe(null);
    // The other period was an answer to the role the account had: gone too.
    expect(store.viewFor('installation', 7)).toBe(null);
    expect(store.statusFor('installation', 7)).toBe('idle');
    expect(store.viewFor('mine', 30)!.board.conversations.value).toBe(1);
    expect(store.statusFor('mine', 30)).toBe('ready');
  });

  test('is asked again by the next load, and an answer replaces it', async () => {
    const store = useProfileStatsStore();
    forbidden = true;
    await store.load('installation', 30, 'UTC');
    forbidden = false;
    served = 4;
    at(1);

    await store.load('installation', 30, 'UTC');

    expect(installationCalls.length).toBe(2);
    expect(store.statusFor('installation', 30)).toBe('ready');
    expect(store.viewFor('installation', 30)!.board.calls.value).toBe(4);
  });

  test('that arrives after the account changed is dropped', async () => {
    const store = useProfileStatsStore();
    forbidden = true;
    const open = hold();
    const late = store.load('installation', 30, 'UTC');

    store.resetForAccount();
    open();
    await late;

    expect(store.views).toEqual({});
  });
});
