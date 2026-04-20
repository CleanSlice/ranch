import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: { '#user': currentDir },
  imports: {
    dirs: [`${currentDir}/stores`],
  },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    langDir: 'locales',
    locales: [{ code: 'en', file: 'en.json' }],
  },
});
