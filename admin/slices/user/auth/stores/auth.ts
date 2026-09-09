import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AuthService, IAuthSession, IAuthUser } from '#auth/domain';

// Re-export the domain types so any consumer importing them from
// `#auth/stores/auth` keeps working.
export type { IAuthState, IAuthUser } from '#auth/domain';

const getService = createServiceGetter<AuthService>('$authService');

const ADMIN_ROLES = ['Owner', 'Admin'] as const;

/** Renew this long before the access token expires. */
const REFRESH_BUFFER_MS = 60_000;
/** Retry cadence when `/auth/refresh` could not be reached at all. */
const NETWORK_RETRY_MS = 30_000;

// Module scope on purpose: one timer and one in-flight refresh for the whole
// tab, shared by the timer, the visibility hook, the 401 interceptor and the
// socket — never several concurrent `/auth/refresh` calls.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<boolean> | null = null;
// Bumped by logout so a refresh that was already on the wire cannot revive
// the session it raced against.
let sessionGeneration = 0;

/** A network-level failure: the request left, nothing came back. */
function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { response?: unknown; request?: unknown; code?: string };
  return !e.response && (!!e.request || e.code === 'ERR_NETWORK');
}

function readErrorCode(err: unknown): string | null {
  const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data
    ?.code;
  return typeof code === 'string' ? code : null;
}

export const useAuthStore = defineStore('auth', () => {
  // Memory only. The HttpOnly session cookie (scoped to `/auth`) is what
  // survives a reload; boot trades it for a token via `hydrate()`.
  const accessToken = ref<string | null>(null);
  const expiresAt = ref<number | null>(null);
  const user = ref<IAuthUser | null>(null);
  const isHydrated = ref(false);
  const sessionEnded = ref(false);
  const sessionEndedCode = ref<string | null>(null);

  // A token without a user (or the other way round) is not a session: the
  // middleware must not treat a half-state as signed in.
  const isAuthenticated = computed(() => !!accessToken.value && !!user.value);
  const hasAdminAccess = computed(() =>
    (ADMIN_ROLES as readonly string[]).includes(user.value?.role ?? ''),
  );

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function armTimer(delayMs: number) {
    clearRefreshTimer();
    if (!import.meta.client || delayMs <= 0) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, delayMs);
  }

  /** Re-arm the proactive renewal for the current token (60 s before expiry). */
  function scheduleRefresh() {
    clearRefreshTimer();
    if (expiresAt.value === null || !accessToken.value) return;
    armTimer(expiresAt.value - Date.now() - REFRESH_BUFFER_MS);
  }

  function clearToken() {
    clearRefreshTimer();
    accessToken.value = null;
    expiresAt.value = null;
  }

  /** Adopt a login / refresh result and schedule the next renewal. */
  function applySession(session: IAuthSession) {
    accessToken.value = session.accessToken;
    user.value = session.user;
    expiresAt.value = Date.now() + session.expiresIn * 1000;
    sessionEnded.value = false;
    sessionEndedCode.value = null;
    scheduleRefresh();
  }

  /**
   * The session is gone while the person was working: drop the token but keep
   * the user so the in-place dialog can prefill the email and the page stays
   * where it is. Idempotent — concurrent failures produce one dialog.
   */
  function endSession(code: string | null) {
    clearToken();
    if (sessionEnded.value) return;
    sessionEnded.value = true;
    sessionEndedCode.value = code;
  }

  async function doRefresh(): Promise<boolean> {
    const generation = sessionGeneration;
    try {
      const session = await getService().refresh();
      // Logged out while this was on the wire — the result is stale.
      if (generation !== sessionGeneration) return false;
      applySession(session);
      return true;
    } catch (err) {
      if (generation !== sessionGeneration) return false;
      if (isNetworkError(err)) {
        // The API was unreachable, not the session: keep the token (it may
        // still be valid) and try again shortly.
        armTimer(NETWORK_RETRY_MS);
        return false;
      }
      // SESSION_* (or anything else): the token cannot be renewed. Mid-use
      // (a user is loaded) that is the honest "session ended" state; at boot
      // (no user yet) it is simply "not signed in".
      if (user.value) endSession(readErrorCode(err));
      else clearToken();
      return false;
    }
  }

  /** Renew the access token from the session cookie. Deduped: one call in flight. */
  function refresh(): Promise<boolean> {
    if (!refreshInFlight) {
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  /**
   * Refresh now when the token is inside the renewal buffer (a tab that was
   * hidden past the timer, a socket about to connect), else re-arm the timer.
   */
  async function ensureFresh(): Promise<void> {
    if (!accessToken.value || expiresAt.value === null) return;
    if (expiresAt.value - Date.now() < REFRESH_BUFFER_MS) {
      await refresh();
      return;
    }
    scheduleRefresh();
  }

  async function login(email: string, password: string) {
    const session = await getService().login(email, password);
    applySession(session);
    return session;
  }

  /**
   * Explicit sign-out. State is cleared synchronously so callers that
   * navigate right after (`logout(); navigateTo('/login')`) see "signed out"
   * immediately; the cookie revocation is best effort.
   */
  async function logout() {
    sessionGeneration += 1;
    refreshInFlight = null;
    clearToken();
    user.value = null;
    sessionEnded.value = false;
    sessionEndedCode.value = null;
    try {
      await getService().logout();
    } catch {
      // The cookie is scoped to /auth and expires on its own; a failed
      // revoke must not block signing out locally.
    }
  }

  async function fetchMe() {
    user.value = await getService().me();
    return user.value;
  }

  /**
   * Boot: refresh-first. A live cookie yields token + user in one round trip;
   * anything else means "not signed in" — silently, nobody was mid-task.
   */
  async function hydrate() {
    if (isHydrated.value) return;
    if (import.meta.client) await refresh();
    isHydrated.value = true;
  }

  return {
    accessToken,
    expiresAt,
    user,
    isHydrated,
    sessionEnded,
    sessionEndedCode,
    isAuthenticated,
    hasAdminAccess,
    applySession,
    login,
    logout,
    refresh,
    ensureFresh,
    endSession,
    hydrate,
    fetchMe,
  };
});
