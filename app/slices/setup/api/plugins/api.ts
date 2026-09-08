import type { InternalAxiosRequestConfig } from 'axios';
import { client } from '../data/repositories/api/client.gen';

/**
 * A request config the response interceptor may have already re-issued once
 * after a refresh (CLEAN-72). The mark lives on the config so the retried
 * attempt, which carries the same object, is never retried a second time.
 */
interface IRetriableRequestConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

const SHARE_TOKEN_HEADER = 'X-Share-Token';
const AUTH_HEADER = 'Authorization';

// Axios normalises request headers into an `AxiosHeaders` (case-insensitive
// `has` / `set`); a plain object is tolerated so a hand-built config never
// throws here.
function hasHeader(
  headers: InternalAxiosRequestConfig['headers'] | undefined,
  name: string,
): boolean {
  if (!headers) return false;
  if (typeof headers.has === 'function') return headers.has(name);
  const target = name.toLowerCase();
  return Object.entries(headers as Record<string, unknown>).some(
    ([key, value]) => key.toLowerCase() === target && value != null,
  );
}

function setHeader(
  headers: InternalAxiosRequestConfig['headers'],
  name: string,
  value: string,
): void {
  if (typeof headers.set === 'function') headers.set(name, value);
  else (headers as Record<string, unknown>)[name] = value;
}

export default defineNuxtPlugin({
  name: 'api-base-url',
  setup() {
    const runtime = useRuntimeConfig();
    const apiUrl = runtime.public.apiUrl;
    // `withCredentials` is what carries the httpOnly session cookie to
    // `/auth/refresh` and `/auth/logout` (CLEAN-72). Set on the SDK config
    // (spread into every generated call) and on the axios defaults (direct
    // `client.instance` calls such as the attachment upload).
    client.setConfig({
      ...(apiUrl ? { baseURL: apiUrl } : {}),
      withCredentials: true,
    });
    client.instance.defaults.withCredentials = true;

    const nuxtApp = useNuxtApp();

    // Request: attach the in-memory bearer on every attempt, so a retried
    // request reads the renewed token rather than a captured one. Share-link
    // requests carry `X-Share-Token` with an explicit `Authorization: null`
    // (`#bridle/data/bridle.gateway.ts`); on the API a valid JWT wins over the
    // share headers, so those are left untouched — an owner opening their own
    // link must chat as a visitor.
    client.instance.interceptors.request.use((config) => {
      if (hasHeader(config.headers, SHARE_TOKEN_HEADER)) return config;
      const token = useAuthStore().accessToken;
      if (token) setHeader(config.headers, AUTH_HEADER, `Bearer ${token}`);
      return config;
    });

    // Response: a 401 outside the auth flow is either a token that can be
    // renewed (`TOKEN_EXPIRED`, or `TOKEN_INVALID` after a secret rotation —
    // refresh once, retry once, otherwise the session-ended dialog) or a
    // request that never carried one (`TOKEN_MISSING` — logged out). Auth-flow
    // endpoints (/auth/login, /auth/register, /auth/refresh, /auth/me) are
    // excluded: a login 401 is a credential error shown inline on the form,
    // and a refresh 401 is the store's own verdict on the session.
    client.instance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status = error?.response?.status;
        const url = String(error?.config?.url ?? '');
        const code: unknown = error?.response?.data?.code;
        const config = error?.config as IRetriableRequestConfig | undefined;
        // `/share` is a public page with no session of its own: its endpoints
        // answer 403/404, and a stale console token in the same browser must
        // not bounce a visitor to the login form (CLEAN-66). Read lazily, so
        // the router is only touched on the 401s that were already going to
        // consult it two lines below. Both spellings are matched: Nuxt's
        // `trailingSlash` config (and a link pasted as `/share/?token=…`)
        // decides which one the router reports, and a visitor must not be
        // redirected to /login because of a slash.
        const onSharePage = () => {
          const path = nuxtApp.$router.currentRoute.value.path;
          return path === '/share' || path === '/share/';
        };
        if (
          !import.meta.client ||
          status !== 401 ||
          url.includes('/auth/') ||
          onSharePage() ||
          !config ||
          config._retried === true
        ) {
          return Promise.reject(error);
        }

        if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') {
          const ok = await nuxtApp.runWithContext(() => useAuthStore().refresh());
          const token = useAuthStore().accessToken;
          if (ok && token) {
            config._retried = true;
            setHeader(config.headers, AUTH_HEADER, `Bearer ${token}`);
            return client.instance.request(config);
          }
          useAuthStore().endSession(code);
          return Promise.reject(error);
        }

        // `TOKEN_MISSING` (or a 401 with no code): nothing to renew.
        await nuxtApp.runWithContext(() => {
          void useAuthStore().logout();
          if (nuxtApp.$router.currentRoute.value.path !== '/login') {
            return navigateTo('/login');
          }
        });
        return Promise.reject(error);
      },
    );
  },
});
