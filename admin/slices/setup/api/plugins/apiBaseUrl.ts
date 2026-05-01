import { client } from '../data/repositories/api/client.gen';

export default defineNuxtPlugin({
  enforce: 'pre',
  setup() {
    const config = useRuntimeConfig();
    client.setConfig({ baseURL: config.public.apiUrl as string });

    // Attach the bearer token on every request from the access_token cookie.
    // Reading per-request avoids depending on plugin order or on a separate
    // hydration step — the cookie is the single source of truth. We read
    // document.cookie directly because the interceptor fires outside a Nuxt
    // setup context, where useCookie is not callable.
    client.instance.interceptors.request.use((requestConfig) => {
      if (typeof document === 'undefined') return requestConfig;
      const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      if (token) {
        requestConfig.headers.set('Authorization', `Bearer ${token}`);
      }
      return requestConfig;
    });
  },
});
