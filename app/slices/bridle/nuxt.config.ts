import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { LOCALES } from '../setup/i18n/locales';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: {
    '#bridle': currentDir,
  },
  imports: {
    dirs: [`${currentDir}/stores`],
  },
  // The chat markdown rules are global and needed wherever a message is
  // rendered, the chat history included, so the slice loads them itself
  // instead of a component carrying a copy (CLEAN-137).
  css: [`${currentDir}/assets/chat-md.css`],
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: 'locales',
    locales: LOCALES,
  },
});
