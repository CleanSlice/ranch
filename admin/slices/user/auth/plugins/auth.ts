export default defineNuxtPlugin({
  name: 'auth-init',
  parallel: false,
  // `auth-di` must provide $authService before hydrate() → me() runs here.
  dependsOn: ['api-base-url', 'auth-di'],
  async setup() {
    const authStore = useAuthStore();
    await authStore.hydrate();
  },
});
