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
  imports: {
    dirs: [`${currentDir}/stores`],
  },
  // The Statistics tab's colours and block rules (CLEAN-258). One global
  // sheet scoped to `[data-profile-stats]` rather than a `<style>` per
  // component: a dozen blocks share the same tokens, and the detail pop-up is
  // drawn outside the page's own tree, where a scoped style would not reach.
  css: [`${currentDir}/assets/stats.css`],
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: 'locales',
    locales: LOCALES,
  },
});
