import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { IPersonalStats, ProfileStatsService } from '#profile/domain';
import type { StatsPeriod, StatsScope } from '#profile/utils/statsView';

const getService = createServiceGetter<ProfileStatsService>('$profileStatsService');

/**
 * How long a view is shown without asking again. The figures behind it change
 * at most once per message, and the tab is often reopened by Back: a minute
 * spares that reopening a request and is still well inside the five minutes
 * in which a message has to show up on the page (spec 038, SC-003).
 */
export const STALE_MS = 60_000;

export type StatsViewStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The scopes this store can fetch. The installation joins with its view: its
 * figures have another shape and another route, and until both exist the type
 * keeps anyone from asking for them.
 */
export type StatsStoreScope = Extract<StatsScope, 'mine'>;

/** One period view as far as it has been loaded. */
export interface IStatsViewEntry {
  status: StatsViewStatus;
  /** The last answer. It stays while a newer one is on its way, and after a failure. */
  data: IPersonalStats | null;
  /** When `data` was answered, in epoch milliseconds: what staleness is counted from. */
  loadedAt: number | null;
}

function keyOf(scope: StatsStoreScope, period: StatsPeriod): string {
  return `${scope}:${period}`;
}

/**
 * The one place a period view lives (docs/state.md): `load` fetches and
 * upserts, the provider renders by scope and period, and no component keeps
 * a copy of its own.
 */
export const useProfileStatsStore = defineStore('profileStats', () => {
  /** Every view this account has loaded, by `scope:period`. */
  const views = ref<Record<string, IStatsViewEntry>>({});

  // Bumped by `resetForAccount`: an answer that was on its way when the
  // account changed is the previous account's and is dropped.
  let accountGeneration = 0;
  // The requests still open, by view: two loads of one view are one request.
  // Not state: a promise is nothing to render.
  let open = new Map<string, Promise<void>>();

  /**
   * Whoever was signed in is not any more (CLEAN-231): their figures leave
   * the page with them. The ONE way this store is emptied for an account
   * change (docs/state.md, rule 7).
   */
  function resetForAccount() {
    accountGeneration += 1;
    views.value = {};
    open = new Map();
  }

  /** The view's entry, created empty on first use. Always the reactive one. */
  function entryOf(key: string): IStatsViewEntry {
    if (!views.value[key]) {
      views.value[key] = { status: 'idle', data: null, loadedAt: null };
    }
    return views.value[key]!;
  }

  /**
   * Make sure the view is there and fresh. A view answered less than
   * `STALE_MS` ago is left alone; an older one is fetched again while it
   * stays on screen; one whose last request failed is asked again however
   * soon, since that is what Retry means. Never throws: a failure is the
   * view's status, and what was held stays held.
   */
  function load(scope: StatsStoreScope, period: StatsPeriod, timeZone: string): Promise<void> {
    const key = keyOf(scope, period);
    const running = open.get(key);
    if (running) return running;

    const entry = entryOf(key);
    const fresh =
      entry.status === 'ready' &&
      entry.loadedAt !== null &&
      Date.now() - entry.loadedAt < STALE_MS;
    if (fresh) return Promise.resolve();

    entry.status = 'loading';
    const account = accountGeneration;
    // An answer is for this account only while nobody else has signed in.
    const still = (): IStatsViewEntry | null =>
      account === accountGeneration ? entryOf(key) : null;

    const request = (async () => {
      try {
        const data = await getService().getMine(period, timeZone);
        const now = still();
        if (!now) return;
        now.data = data;
        now.loadedAt = Date.now();
        now.status = 'ready';
      } catch {
        const now = still();
        if (now) now.status = 'failed';
      } finally {
        // A reset has already put a new map in place; its entries are the
        // next account's and are not this request's to remove.
        if (account === accountGeneration) open.delete(key);
      }
    })();
    open.set(key, request);
    return request;
  }

  /** The view as last answered, or `null` while none has been. */
  function viewFor(scope: StatsStoreScope, period: StatsPeriod): IPersonalStats | null {
    return views.value[keyOf(scope, period)]?.data ?? null;
  }

  function statusFor(scope: StatsStoreScope, period: StatsPeriod): StatsViewStatus {
    return views.value[keyOf(scope, period)]?.status ?? 'idle';
  }

  return {
    views,
    load,
    viewFor,
    statusFor,
    resetForAccount,
  };
});
