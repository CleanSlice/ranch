import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n'],
  i18n: {
    restructureDir: false,
    vueI18n: resolve(currentDir, 'configs/i18n.config.ts'),
    strategy: 'no_prefix',
    defaultLocale: 'en',
    bundle: {
      optimizeTranslationDirective: false,
    },
  },
});
