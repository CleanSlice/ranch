import { restoresSession } from '#auth/domain/sessionRoutes';

/**
 * Restore the auth session before the first navigation. Runs on the client
 * (the session cookie is only useful in a browser). The middleware waits for
 * `isHydrated` so guarded routes don't redirect prematurely on F5.
 *
 * Not when the app is entered on the share page: a visitor page makes its own
 * requests and no others (CLEAN-239). The route is not resolved yet at plugin
 * time, so the address bar is read. If the person goes on to a console route
 * in the same tab, `auth.global.ts` restores the session then.
 */
export default defineNuxtPlugin({
  name: 'auth-init',
  parallel: false,
  // `auth-di` must provide $authService before init() → refresh() runs here.
  dependsOn: ['api-base-url', 'auth-di'],
  async setup() {
    if (!import.meta.client) return;
    const authStore = useAuthStore();
    if (restoresSession(window.location.pathname)) await authStore.init();

    // Browsers throttle timers in background tabs, so the proactive refresh
    // can fire late or not at all; catching up when the tab comes back is
    // what keeps a long-open chat from expiring under the person (CLEAN-72).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void authStore.ensureFresh();
    });
  },
});
