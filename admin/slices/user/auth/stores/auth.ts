import { AuthService } from '#api/data';
import { handleApiAuthentication } from '#api/utils/handleApiAuthentication';

type ApiEnvelope<T> = { success: boolean; data: T };

const ADMIN_ROLES = ['Owner', 'Admin'] as const;

export interface IAuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: string;
}

export interface IAuthState {
  accessToken: string | null;
  user: IAuthUser | null;
}

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
    !!user.value?.roles?.some((role) => (ADMIN_ROLES as readonly string[]).includes(role)),
  );

  function applyToken(token: string | null) {
    accessToken.value = token;
    tokenCookie.value = token;
    handleApiAuthentication(token ?? undefined);
  }

  async function login(email: string, password: string) {
    const res = await AuthService.authControllerLogin({
      body: { email, password },
    });
    const env = res.data as ApiEnvelope<{ accessToken: string; user: IAuthUser }>;
    applyToken(env.data.accessToken);
    user.value = env.data.user;
    return env.data;
  }

  function logout() {
    applyToken(null);
    user.value = null;
  }

  async function fetchMe() {
    const res = await AuthService.authControllerMe();
    const env = res.data as ApiEnvelope<IAuthUser> | undefined;
    user.value = env?.data ?? null;
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
