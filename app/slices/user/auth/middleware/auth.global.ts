/**
 * Public routes (Q2-C):
 *   - /              landing
 *   - /chat          public chat with whichever agent
 *   - /login         self
 *   - /register      self (gated by setting on the server side)
 *
 * Anything under /agents/** requires login. The auth plugin awaits init()
 * before navigation kicks in, so isHydrated is always true when this runs.
 */
const PROTECTED_PREFIXES = ['/agents'];
const AUTH_PAGES = new Set(['/login', '/register']);

export default defineNuxtRouteMiddleware((to) => {
  if (!import.meta.client) return;

  const authStore = useAuthStore();
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => to.path === prefix || to.path.startsWith(`${prefix}/`),
  );

  if (isProtected && !authStore.isAuthenticated) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    });
  }

  if (AUTH_PAGES.has(to.path) && authStore.isAuthenticated) {
    return navigateTo('/agents');
  }
});
