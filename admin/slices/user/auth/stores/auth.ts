import { createServiceGetter } from '#common/composables/createServiceGetter';
import { handleApiAuthentication } from '#api/utils/handleApiAuthentication';
import type { AuthService, IAuthUser } from '#auth/domain';

// Re-export the domain types so any consumer importing them from
// `#auth/stores/auth` keeps working.
export type { IAuthState, IAuthUser } from '#auth/domain';

const getService = createServiceGetter<AuthService>('$authService');

const ADMIN_ROLES = ['Owner', 'Admin'] as const;

export const useAuthStore = defineStore('auth', () => {
  const tokenCookie = useCookie<string | null>('access_token', {
    default: () => null,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  const accessToken = ref<string | null>(tokenCookie.value);
  const user = ref<IAuthUser | null>(null);

  const isAuthenticated = computed(() => !!accessToken.value);
  const hasAdminAccess = computed(() =>
    (ADMIN_ROLES as readonly string[]).includes(user.value?.role ?? ''),
  );

  function applyToken(token: string | null) {
    accessToken.value = token;
    tokenCookie.value = token;
    handleApiAuthentication(token ?? undefined);
  }

  async function login(email: string, password: string) {
    const session = await getService().login(email, password);
    applyToken(session.accessToken);
    user.value = session.user;
    return session;
  }

  function logout() {
    applyToken(null);
    user.value = null;
  }

  async function fetchMe() {
    user.value = await getService().me();
    return user.value;
  }

  async function hydrate() {
    if (!accessToken.value) return;
    handleApiAuthentication(accessToken.value);
    if (user.value) return;
    try {
      await fetchMe();
    } catch {
      logout();
    }
  }

  return {
    accessToken,
    user,
    isAuthenticated,
    hasAdminAccess,
    login,
    logout,
    hydrate,
    fetchMe,
  };
});
