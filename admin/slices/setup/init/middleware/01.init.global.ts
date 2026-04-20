export default defineNuxtRouteMiddleware(async (to) => {
  const initStore = useInitStore();
  const requiresInit = await initStore.ensureChecked();

  if (requiresInit && to.path !== '/setup') {
    return navigateTo('/setup');
  }
  if (!requiresInit && to.path === '/setup') {
    return navigateTo('/login');
  }
});
