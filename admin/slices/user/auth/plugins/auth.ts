export default defineNuxtPlugin({
  name: 'auth-init',
  parallel: false,
  // `auth-di` must provide $authService before hydrate() → refresh() runs
  // here; `api-base-url` must have set `withCredentials` so the session
  // cookie travels with that first call.
  dependsOn: ['api-base-url', 'auth-di'],
  async setup() {
    const authStore = useAuthStore();
    await authStore.hydrate();

    // A tab hidden past the renewal timer wakes up with a stale token:
    // renew on return (no-op when the token is still comfortably valid).
    if (import.meta.client) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void authStore.ensureFresh();
      });
    }
  },
});
