import { createServiceGetter } from '#common/composables/createServiceGetter';
import { handleApiAuthentication } from '#api/utils/handleApiAuthentication';
import { UserRoleTypes } from '#auth/domain';
import type { AuthService, IAuthUser } from '#auth/domain';

// Re-export the domain enum/types so consumers that import them from
// `#auth/stores/auth` — and the auto-import (imports.dirs) that exposes
// `UserRoleTypes` globally — keep working. `UserRoleTypes` is used as a runtime
// value, so it's a value re-export.
export { UserRoleTypes } from '#auth/domain';
export type { IAuthUser, IAuthSession } from '#auth/domain';

const getService = createServiceGetter<AuthService>('$authService');

export const useAuthStore = defineStore('auth', () => {
  // Token persistence lives in a cookie (7-day, JS-readable) — same convention
  // as the admin. The Bearer header is still attached via
  // handleApiAuthentication; the cookie is only the store.
  const tokenCookie = useCookie<string | null>('access_token', {
    default: () => null,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  const accessToken = ref<string | null>(tokenCookie.value);
  const user = ref<IAuthUser | null>(null);
  /** True after init() has run at least once (used by middleware to wait for hydration). */
  const isHydrated = ref(false);

  const isAuthenticated = computed(() => !!accessToken.value && !!user.value);
  const role = computed<UserRoleTypes | null>(() => user.value?.role ?? null);

  function hasRole(...required: UserRoleTypes[]): boolean {
    if (!required.length) return isAuthenticated.value;
    return required.some((r) => r === role.value);
  }

  function applyToken(token: string | null) {
    accessToken.value = token;
    tokenCookie.value = token;
    handleApiAuthentication(token ?? undefined);
  }

  async function fetchMe() {
    user.value = await getService().me();
    return user.value;
  }

  async function login(email: string, password: string) {
    const session = await getService().login(email, password);
    applyToken(session.accessToken);
    user.value = session.user;
    return session;
  }

  async function register(name: string, email: string, password: string) {
    const session = await getService().register(name, email, password);
    applyToken(session.accessToken);
    user.value = session.user;
    return session;
  }

  function logout() {
    applyToken(null);
    user.value = null;
  }

  /**
   * Restore session from the cookie on first paint. Called by the auth plugin
   * before any guarded navigation. Token present but invalid on server →
   * silently clear, treat as logged out.
   */
  async function init(): Promise<void> {
    if (isHydrated.value) return;
    const stored = accessToken.value;
    if (!stored) {
      isHydrated.value = true;
      return;
    }
    applyToken(stored);
    try {
      await fetchMe();
    } catch {
      applyToken(null);
      user.value = null;
    } finally {
      isHydrated.value = true;
    }
  }

  return {
    accessToken,
    user,
    role,
    isHydrated,
    isAuthenticated,
    hasRole,
    init,
    login,
    register,
    logout,
    fetchMe,
  };
});
