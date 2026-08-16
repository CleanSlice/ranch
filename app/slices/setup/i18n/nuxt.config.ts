import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n'],
  i18n: {
    vueI18n: resolve(currentDir, 'i18n/i18n.config.ts'),
    strategy: 'no_prefix',
    defaultLocale: 'en',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },
});
