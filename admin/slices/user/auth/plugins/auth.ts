export default defineNuxtPlugin({
  name: 'auth-init',
  parallel: false,
  dependsOn: ['api-base-url'],
  async setup() {
    const authStore = useAuthStore();
    await authStore.hydrate();
  },
});
