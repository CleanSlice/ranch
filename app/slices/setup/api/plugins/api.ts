import { client } from '../data/repositories/api/client.gen';

export default defineNuxtPlugin({
  name: 'api-base-url',
  setup() {
    const runtime = useRuntimeConfig();
    const apiUrl = runtime.public.apiUrl;
    if (apiUrl) client.setConfig({ baseURL: apiUrl });

    const nuxtApp = useNuxtApp();

    // Kick the user out on a session 401 (expired / missing token). Auth-flow
    // endpoints (/auth/login, /auth/register, /auth/me) are excluded: a login
    // 401 is a credential error shown inline on the form, and an init() /auth/me
    // 401 is handled silently by the auth store (so a returning visitor with a
    // stale token still lands on the public pages, logged out).
    client.instance.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        const url = String(error?.config?.url ?? '');
        if (import.meta.client && status === 401 && !url.includes('/auth/')) {
          nuxtApp.runWithContext(() => {
            useAuthStore().logout();
            if (nuxtApp.$router.currentRoute.value.path !== '/login') {
              return navigateTo('/login');
            }
          });
        }
        return Promise.reject(error);
      },
    );
  },
});
