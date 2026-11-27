import { createServiceGetter } from '#common/composables/createServiceGetter';
import {
  StatsForbiddenError,
  type IInstallationStats,
  type IPersonalStats,
  type ProfileStatsService,
} from '#profile/domain';
import type { StatsPeriod, StatsScope } from '#profile/utils/statsView';

const getService = createServiceGetter<ProfileStatsService>('$profileStatsService');

/**
 * How long a view is shown without asking again. The figures behind it change
 * at most once per message, and the tab is often reopened by Back: a minute
 * spares that reopening a request and is still well inside the five minutes
 * in which a message has to show up on the page (spec 038, SC-003).
 */
export const STALE_MS = 60_000;

/**
 * `forbidden` is the installation's alone: its route refused the caller
 * (403). It is not `failed`: nothing went wrong, there is nothing to retry,
 * and the page says whom the figures are for instead.
 */
export type StatsViewStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'forbidden';

/** The scopes this store can fetch: the person's own view and the installation's. */
export type StatsStoreScope = StatsScope;

/** What a view of each scope holds: two shapes, from two routes. */
export interface IStatsByScope {
  mine: IPersonalStats;
  installation: IInstallationStats;
}

/** One period view as far as it has been loaded. */
export interface IStatsViewEntry {
  status: StatsViewStatus;
  /**
   * The last answer, of the shape its scope has. It stays while a newer one
   * is on its way, and after a failure; a refusal removes it.
   */
  data: IPersonalStats | IInstallationStats | null;
  /** When `data` was answered, in epoch milliseconds: what staleness is counted from. */
  loadedAt: number | null;
}

const INSTALLATION: StatsStoreScope = 'installation';

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
   * The installation's route refused this account: whatever the store holds
   * of the installation was answered to a role the account no longer has, so
   * all of it goes, every period. The personal views are the person's own
   * and stay.
   */
  function dropInstallation() {
    const prefix = `${INSTALLATION}:`;
    for (const key of Object.keys(views.value)) {
      if (key.startsWith(prefix)) delete views.value[key];
    }
  }

  /**
   * Make sure the view is there and fresh. A view answered less than
   * `STALE_MS` ago is left alone; an older one is fetched again while it
   * stays on screen; one whose last request failed or was refused is asked
   * again however soon, since that is what Retry means and a role can be
   * given back. Never throws: a failure is the view's status, and what was
   * held stays held; a refusal (403) is a status too, and holds nothing.
   *
   * `timeZone` is the viewer's and is sent for the personal view only: the
   * installation's days are UTC days for everyone.
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
        const data =
          scope === INSTALLATION
            ? await getService().getInstallation(period)
            : await getService().getMine(period, timeZone);
        const now = still();
        if (!now) return;
        now.data = data;
        now.loadedAt = Date.now();
        now.status = 'ready';
      } catch (error) {
        if (account !== accountGeneration) return;
        if (error instanceof StatsForbiddenError) {
          dropInstallation();
          // A fresh entry: no view, no age, and the reason on it.
          entryOf(key).status = 'forbidden';
          return;
        }
        entryOf(key).status = 'failed';
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
  function viewFor<S extends StatsStoreScope>(scope: S, period: StatsPeriod): IStatsByScope[S] | null {
    // An entry is only ever written by `load` under its own scope's key, so
    // what is kept under a scope has that scope's shape.
    return (views.value[keyOf(scope, period)]?.data ?? null) as IStatsByScope[S] | null;
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
