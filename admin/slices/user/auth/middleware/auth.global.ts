export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/setup') return;

  const authStore = useAuthStore();
  const isLoginPage = to.path === '/login';

  if (!authStore.isAuthenticated && !isLoginPage) {
    return navigateTo('/login');
  }
  if (authStore.isAuthenticated && isLoginPage) {
    return navigateTo('/agents');
  }
});
