export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n'],
  i18n: {
    vueI18n: './configs/i18n.config.ts',
    strategy: 'no_prefix',
    defaultLocale: 'en',
  },
});
