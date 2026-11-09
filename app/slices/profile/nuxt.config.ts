import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { LOCALES } from '../setup/i18n/locales';

const currentDir = dirname(fileURLToPath(import.meta.url));

// The signed-in person's profile page, "Pass" (CLEAN-217). Its own slice on
// purpose: it reads both the auth store and the agent fleet, and the auth
// slice has no business knowing about agents.
export default defineNuxtConfig({
  alias: {
    '#profile': currentDir,
  },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: 'locales',
    locales: LOCALES,
  },
});
