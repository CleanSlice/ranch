import { client } from '../data/repositories/api/client.gen';

export default defineNuxtPlugin({
  name: 'api-base-url',
  setup() {
    const config = useRuntimeConfig();
    const nuxtApp = useNuxtApp();
    const apiUrl = config.public.apiUrl as string;
    if (apiUrl) {
      client.setConfig({ baseURL: apiUrl });
      client.instance.defaults.baseURL = apiUrl;
    }

    useHead({
      meta: [{ name: 'ranch-api-url', content: apiUrl }],
    });

    // Set baseURL + Authorization on every request. hey-api's setConfig
    // reassigns instance.defaults to a fresh object which axios doesn't
    // always honor on raw instance.get() calls, so we also pin baseURL
    // per-request. The access_token cookie is the single source of truth
    // for auth; reading per-request avoids plugin-order dependencies.
    client.instance.interceptors.request.use((requestConfig) => {
      if (apiUrl && !requestConfig.baseURL) {
        requestConfig.baseURL = apiUrl;
      }
      if (typeof document === 'undefined') return requestConfig;
      const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      if (token) {
        requestConfig.headers.set('Authorization', `Bearer ${token}`);
      }
      return requestConfig;
    });

    // Kick the user out on a session 401 (expired / missing token, e.g.
    // "Missing access token"). Login/register 401s are credential errors shown
    // inline on the form, so leave those for the caller to handle. logout()
    // resets the store's auth state so the middleware sees "not authenticated"
    // and doesn't bounce /login back to /agents.
    client.instance.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        const url = String(error?.config?.url ?? '');
        const isAuthEndpoint =
          url.includes('/auth/login') || url.includes('/auth/register');
        if (import.meta.client && status === 401 && !isAuthEndpoint) {
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
