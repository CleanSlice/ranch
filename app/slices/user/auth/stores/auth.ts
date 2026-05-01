import { AuthService } from '#api/data';
import { handleApiAuthentication } from '#api/utils/handleApiAuthentication';

type ApiEnvelope<T> = { success: boolean; data: T };

export enum UserRoleTypes {
  Owner = 'Owner',
  Admin = 'Admin',
  User = 'User',
}

export interface IAuthUser {
  id: string;
  name: string;
  email: string;
  roles: UserRoleTypes[];
  status: string;
}

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
    const res = await AuthService.authControllerMe();
    const env = res.data as ApiEnvelope<IAuthUser> | undefined;
    user.value = env?.data ?? null;
    return user.value;
  }

  async function login(email: string, password: string) {
    const res = await AuthService.authControllerLogin({
      body: { email, password },
    });
    const env = res.data as ApiEnvelope<{
      accessToken: string;
      user: IAuthUser;
    }>;
    applyToken(env.data.accessToken);
    user.value = env.data.user;
    return env.data;
  }

  async function register(name: string, email: string, password: string) {
    const res = await AuthService.authControllerRegister({
      body: { name, email, password },
    });
    const env = res.data as ApiEnvelope<{
      accessToken: string;
      user: IAuthUser;
    }>;
    applyToken(env.data.accessToken);
    user.value = env.data.user;
    return env.data;
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
