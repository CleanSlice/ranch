import type { InternalAxiosRequestConfig } from 'axios';
import { client } from '../data/repositories/api/client.gen';

/** Marks a request the response interceptor already re-issued once. */
interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

/** 401 codes that mean "the bearer is dead, the session may not be". */
const REFRESHABLE_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID']);

export default defineNuxtPlugin({
  name: 'api-base-url',
  setup() {
    const config = useRuntimeConfig();
    const nuxtApp = useNuxtApp();
    const apiUrl = config.public.apiUrl as string;

    // `withCredentials` carries the HttpOnly `ranch_session` cookie to
    // `/auth/refresh` and `/auth/logout`; every other route authenticates
    // with the bearer attached below.
    client.setConfig({
      ...(apiUrl ? { baseURL: apiUrl } : {}),
      withCredentials: true,
    });
    if (apiUrl) client.instance.defaults.baseURL = apiUrl;
    client.instance.defaults.withCredentials = true;

    useHead({
      meta: [{ name: 'ranch-api-url', content: apiUrl }],
    });

    // Interceptors run outside any component / Nuxt context; hand pinia in
    // explicitly instead of relying on injection.
    const getAuthStore = () => useAuthStore(nuxtApp.$pinia);

    // Set baseURL + Authorization on every request. hey-api's setConfig
    // reassigns instance.defaults to a fresh object which axios doesn't
    // always honor on raw instance.get() calls, so we also pin baseURL
    // per-request. The token lives in the auth store (memory only); reading
    // it per request means a retry, a late XHR and the socket all see the
    // current value, never one captured at call time.
    client.instance.interceptors.request.use((requestConfig) => {
      if (apiUrl && !requestConfig.baseURL) {
        requestConfig.baseURL = apiUrl;
      }
      requestConfig.withCredentials = true;
      if (!import.meta.client) return requestConfig;
      if (requestConfig.headers.has('Authorization')) return requestConfig;
      const token = getAuthStore().accessToken;
      if (token) {
        requestConfig.headers.set('Authorization', `Bearer ${token}`);
      }
      return requestConfig;
    });

    // 401 outside `/auth/*`:
    //  - TOKEN_EXPIRED / TOKEN_INVALID → refresh once and re-issue the same
    //    request with the new bearer; if the refresh fails the store enters
    //    the session-ended state (in-place dialog) and the error propagates.
    //  - TOKEN_MISSING / no code → nothing to renew: logged out + /login.
    // Login/register/refresh 401s are credential or session errors handled
    // by their callers, so `/auth/*` is left alone.
    client.instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status = error?.response?.status;
        const requestConfig = error?.config as RetriableRequestConfig | undefined;
        const url = String(requestConfig?.url ?? '');
        if (
          !import.meta.client ||
          status !== 401 ||
          !requestConfig ||
          url.includes('/auth/') ||
          requestConfig._retried === true
        ) {
          return Promise.reject(error);
        }

        const authStore = getAuthStore();
        // The dialog already owns the screen; a stray poll must not tear it
        // down by logging the person out.
        if (authStore.sessionEnded) return Promise.reject(error);

        const rawCode = error?.response?.data?.code;
        const code = typeof rawCode === 'string' ? rawCode : null;

        if (code && REFRESHABLE_CODES.has(code)) {
          const ok = await authStore.refresh();
          const token = authStore.accessToken;
          if (ok && token) {
            requestConfig._retried = true;
            requestConfig.headers.set('Authorization', `Bearer ${token}`);
            return client.instance.request(requestConfig);
          }
          authStore.endSession(code);
          return Promise.reject(error);
        }

        await nuxtApp.runWithContext(async () => {
          await useAuthStore().logout();
          if (nuxtApp.$router.currentRoute.value.path !== '/login') {
            await navigateTo('/login');
          }
        });
        return Promise.reject(error);
      },
    );
  },
});
