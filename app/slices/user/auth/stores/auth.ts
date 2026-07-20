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

const TOKEN_STORAGE_KEY = 'ranch.access_token';

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // quota / privacy mode — silently ignore, in-memory state still works
  }
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<IAuthUser | null>(null);
  /** True after init() has run at least once (used by middleware to wait for hydration). */
  const isHydrated = ref(false);

  const isAuthenticated = computed(() => !!accessToken.value && !!user.value);
  const roles = computed<UserRoleTypes[]>(() => user.value?.roles ?? []);

  function hasRole(...required: UserRoleTypes[]): boolean {
    if (!required.length) return isAuthenticated.value;
    return required.some((r) => roles.value.includes(r));
  }

  function applyToken(token: string | null) {
    accessToken.value = token;
    writeStoredToken(token);
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
   * Restore session from storage on first paint. Called by the auth plugin
   * before any guarded navigation. Token in storage but invalid on server →
   * silently clear, treat as logged out.
   */
  async function init(): Promise<void> {
    if (isHydrated.value) return;
    const stored = readStoredToken();
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
    roles,
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
