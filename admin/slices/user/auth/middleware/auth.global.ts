export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/setup') return;

  const authStore = useAuthStore();
  const isLoginPage = to.path === '/login';
  const isAccessDeniedPage = to.path === '/access-denied';

  if (!authStore.isAuthenticated) {
    if (isLoginPage) return;
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
