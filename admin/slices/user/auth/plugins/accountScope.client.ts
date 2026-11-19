import type { Pinia, StoreGeneric } from 'pinia';
import { sweepUnscopedKeys } from '#bridle/utils/storageKeys';
import { KEPT_STORES, restoreState, snapshotState } from '#auth/utils/accountReset';

/** Where an operator lands in this console; the middleware sends anyone else on. */
const LANDING = '/agents';

interface ITrackedStore {
  store: StoreGeneric;
  /** The state it was created with; null when it empties itself or is kept. */
  snapshot: Record<string, unknown> | null;
}

/**
 * Nothing carries over between accounts in one browser (CLEAN-231, spec 032
 * FR-028 to FR-031). Twin of `app/slices/user/auth/plugins/accountScope.client.ts`:
 * the same watcher, the same three changes, the same order.
 *
 * The signed-in id is the one thing that says whose page this is, so this
 * watches it, the way the Sentry plugin does. Whenever it changes, every
 * store that holds an account's data is emptied, live sockets are closed with
 * it, and what `useAsyncData` kept is dropped.
 *
 * The watcher is synchronous on purpose. `logout()` sets the user to null and
 * the stores are empty before that assignment returns, so before the caller's
 * navigation even starts. A sign-in sets the new user and the stores are
 * empty before anything can be drawn for them: a renderer only runs after
 * the code that assigned the user has finished.
 *
 *   - someone signs out (id → null): the page stops showing their data;
 *   - someone signs in (null → id): whatever a request of the previous
 *     account brought back after they left is dropped as well;
 *   - a different account signs in in the session-ended dialog (id → other
 *     id): the page behind the dialog was the previous person's, so it is
 *     emptied and the console goes to its landing.
 * The same account signing in again in that dialog changes nothing here: the
 * id is the same, and the page is kept for them to continue.
 *
 * Where this console differs from the app: it has some thirty stores and
 * nearly all of them hold what the operator could read. A store that has a
 * `resetForAccount()` is emptied through it (docs/state.md); every other
 * one, except the few that are about no account, is put back to the state it
 * was created with (`#auth/utils/accountReset`). Each store is seen as it is
 * created, so one added later is covered without being listed here.
 */
export default defineNuxtPlugin({
  name: 'account-scope',
  setup(nuxtApp) {
    // Once per browser: what was kept before keys carried an account.
    try {
      sweepUnscopedKeys(window.localStorage);
    } catch {
      // Storage blocked: nothing was kept, nothing to remove.
    }

    const tracked = new Map<string, ITrackedStore>();
    (nuxtApp.$pinia as Pinia).use(({ store }) => {
      const own =
        typeof (store as { resetForAccount?: unknown }).resetForAccount ===
        'function';
      tracked.set(store.$id, {
        store,
        snapshot:
          own || KEPT_STORES.has(store.$id)
            ? null
            : snapshotState(store.$state as Record<string, unknown>),
      });
    });

    const auth = useAuthStore();
    const router = useRouter();

    function resetAccountData() {
      for (const { store, snapshot } of tracked.values()) {
        const own = (store as { resetForAccount?: () => void }).resetForAccount;
        if (typeof own === 'function') {
          own.call(store);
        } else if (snapshot) {
          store.$patch((state: Record<string, unknown>) =>
            restoreState(state, snapshot),
          );
        }
      }
      void nuxtApp.runWithContext(() => clearNuxtData());
    }

    watch(
      () => auth.user?.id ?? null,
      (id, previous) => {
        if (id === previous) return;
        resetAccountData();
        if (id === null || previous === null) return;
        // Another account, in place. The address may still name an agent of
        // the previous one, so leave it; where the address does not change,
        // ask again for what the page shows.
        void nextTick(async () => {
          const before = router.currentRoute.value.fullPath;
          await router.replace(LANDING).catch(() => undefined);
          if (router.currentRoute.value.fullPath === before) {
            await nuxtApp.runWithContext(() => refreshNuxtData());
          }
        });
      },
      { flush: 'sync' },
    );
  },
});
