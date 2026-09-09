export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/setup') return;

  const authStore = useAuthStore();
  const isLoginPage = to.path === '/login';
  const isAccessDeniedPage = to.path === '/access-denied';

  if (!authStore.isAuthenticated) {
    if (isLoginPage) return;
    // The session ended mid-use: the in-place dialog owns the screen and the
    // page must stay where it is, so a stray programmatic navigation is
    // dropped instead of bouncing to /login.
    if (authStore.sessionEnded) return false;
    return navigateTo('/login');
  }

  if (isLoginPage) {
    return navigateTo(authStore.hasAdminAccess ? '/agents' : '/access-denied');
  }

  if (!authStore.hasAdminAccess && !isAccessDeniedPage) {
    return navigateTo('/access-denied');
  }

  if (authStore.hasAdminAccess && isAccessDeniedPage) {
    return navigateTo('/agents');
  }
});
