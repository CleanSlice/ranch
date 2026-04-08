export default defineNuxtConfig({
  modules: ['@pinia/nuxt'],
  imports: {
    dirs: ['stores', 'slices/*/stores'],
  },
});
