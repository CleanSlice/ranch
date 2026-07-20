/**
 * Restore the auth session before the first navigation. Runs on the client
 * (localStorage is unavailable on the server). The middleware waits for
 * `isHydrated` so guarded routes don't redirect prematurely on F5.
 */
export default defineNuxtPlugin({
  name: 'auth-init',
  parallel: false,
  // `auth-di` must provide $authService before init() → me() runs here.
  dependsOn: ['api-base-url', 'auth-di'],
  async setup() {
    if (!import.meta.client) return;
    const authStore = useAuthStore();
    await authStore.init();
  },
});
