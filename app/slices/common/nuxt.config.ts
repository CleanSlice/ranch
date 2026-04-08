import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: {
    '#common': currentDir,
  },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: './locales',
    locales: [{ code: 'en', file: 'en.json' }],
  },
});
