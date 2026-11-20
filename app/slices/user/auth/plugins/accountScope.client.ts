import { sweepUnscopedKeys } from '#bridle/utils/storageKeys';

/** Where a person lands in this console; the page there picks their agent. */
const LANDING = '/agents';

/**
 * Nothing carries over between accounts in one browser (CLEAN-231, spec 032
 * FR-028 to FR-031). Twin of `admin/slices/user/auth/plugins/accountScope.client.ts`.
 *
 * The signed-in id is the one thing that says whose page this is, so this
 * watches it, the way the Sentry plugin does. Whenever it changes, every
 * store that holds an account's data is emptied through its own
 * `resetForAccount()`, live channels are closed with it, and what
 * `useAsyncData` kept is dropped.
 *
 * The watcher is synchronous on purpose. `logout()` sets the user to null and
 * the stores are empty before that assignment returns, so before the caller's
 * navigation even starts. A sign-in sets the new user and the stores are
 * empty before anything can be drawn for them: a renderer only runs after
 * the code that assigned the user has finished.
 *
 * Three changes, one rule:
 *   - someone signs out (id → null): the page stops showing their data;
 *   - someone signs in (null → id): whatever a request of the previous
 *     account brought back after they left is dropped as well;
 *   - a different account signs in in the session-ended dialog (id → other
 *     id): the page behind the dialog was the previous person's, so it is
 *     emptied and the console goes to its landing.
 * The same account signing in again in that dialog changes nothing here: the
 * id is the same, and the page is kept for them to continue (CLEAN-72).
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

    const auth = useAuthStore();
    const router = useRouter();

    /** Every store that holds an account's data, each through its one function. */
    function resetAccountData() {
      void nuxtApp.runWithContext(() => {
        useBridleStore().resetForAccount();
        useAgentStore().resetForAccount();
        useChatStore().resetForAccount();
        useShareStore().resetForAccount();
        useAssistantAccessStore().resetForAccount();
        clearNuxtData();
      });
    }

    watch(
      () => auth.user?.id ?? null,
      (id, previous) => {
        if (id === previous) return;
        resetAccountData();
        if (id === null || previous === null) return;
        // Another account, in place. The address may still name an agent of
        // the previous one, so leave it; where the address does not change
        // (the empty agents page), ask again for what the page shows.
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
