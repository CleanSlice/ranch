import { restoresSession } from '#auth/domain/sessionRoutes';

/**
 * Public routes (Q2-C):
 *   - /              landing
 *   - /login         self
 *   - /register      self (gated by setting on the server side)
 *
 * Anything under /agents/** or /chats/**, and the profile page (CLEAN-217),
 * requires login. The auth plugin awaits init() before navigation kicks in,
 * so isHydrated is already true when this runs — except when the app was
 * entered on the share page, where the session is deliberately not restored
 * (CLEAN-239). init() is a no-op once hydrated, so calling it here only does
 * work on the first navigation from the share page to a console route.
 */
const PROTECTED_PREFIXES = ['/agents', '/chats', '/profile'];
const AUTH_PAGES = new Set(['/login', '/register']);

export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return;

  const authStore = useAuthStore();
  if (restoresSession(to.path)) await authStore.init();
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
