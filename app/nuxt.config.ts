import { registerSlices } from './registerSlices';

export default defineNuxtConfig({
  devtools: { enabled: false },
  extends: [...registerSlices()],
  ssr: false,
  routeRules: {
    '/**': { headers: { 'Cache-Control': 'no-cache' } },
    '/_nuxt/**': {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    },
  },
  vite: {
    define: {
      __VUE_I18N_FULL_INSTALL__: true,
      __VUE_I18N_LEGACY_API__: false,
      __INTLIFY_PROD_DEVTOOLS__: false,
    },
  },
  modules: ['@nuxt/image'],
  compatibilityDate: '2024-10-04',
});
