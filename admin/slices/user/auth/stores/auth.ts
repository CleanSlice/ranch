import { AuthService } from '#api/data';
import { handleApiAuthentication } from '#api/utils/handleApiAuthentication';

type ApiEnvelope<T> = { success: boolean; data: T };

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

  function hydrate() {
    if (accessToken.value) handleApiAuthentication(accessToken.value);
  }

  return { accessToken, user, isAuthenticated, login, logout, hydrate };
});
