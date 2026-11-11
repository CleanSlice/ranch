import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { LOCALES } from '../setup/i18n/locales';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: {
    '#common': currentDir,
  },
  // Landing design tokens + motion. Scoped under `.landing`, so the console
  // pages are unaffected by the import being global.
  // Self-hosted brand faces first, then the landing tokens and motion.
  css: ['#common/assets/css/fonts.css', '#common/assets/css/landing.css'],
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: 'locales',
    locales: LOCALES,
  },
});
