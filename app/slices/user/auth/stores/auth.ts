import { createServiceGetter } from '#common/composables/createServiceGetter';
import { UserRoleTypes } from '#auth/domain';
import type { AuthService, IAuthSession, IAuthUser } from '#auth/domain';

// Re-export the domain enum/types so consumers that import them from
// `#auth/stores/auth` — and the auto-import (imports.dirs) that exposes
// `UserRoleTypes` globally — keep working. `UserRoleTypes` is used as a runtime
// value, so it's a value re-export.
export { UserRoleTypes } from '#auth/domain';
export type { IAuthUser, IAuthSession } from '#auth/domain';

const getService = createServiceGetter<AuthService>('$authService');

/** Renew this long before the access token expires. */
const REFRESH_BUFFER_MS = 60_000;
/** Retry cadence when `/auth/refresh` could not be reached at all. */
const NETWORK_RETRY_MS = 30_000;

// Module scope on purpose: the timer and the in-flight promise are plumbing,
// not state anyone renders, and one of each per tab is the whole point — the
// timer, the visibility hook and the 401 retry path all share one request.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<boolean> | null = null;
/** Bumped by `logout()` so a refresh already in flight is discarded, not applied. */
let refreshGeneration = 0;

/**
 * "Could not reach the API" as opposed to "the API answered". The gateway
 * maps failures through `AuthErrorMapper`, which stamps `statusCode: 0` on a
 * network error; a raw axios error (no mapper) simply has no `response`.
 */
function isNetworkFailure(err: unknown): boolean {
  const e = err as { statusCode?: number; response?: unknown } | null;
  if (typeof e?.statusCode === 'number') return e.statusCode === 0;
  return !e?.response;
}

/**
 * Auth session store (CLEAN-72).
 *
 * The access token lives in memory only. What survives a reload is the
 * httpOnly `ranch_session` cookie scoped to `/auth`, so boot asks
 * `/auth/refresh` for a token instead of reading one back from a JS cookie,
 * and every renewal — the timer armed 60 s before expiry, the tab becoming
 * visible, the 401 retry in the api plugin — funnels through one deduped
 * `refresh()`. The request interceptor in `#api/plugins/api.ts` reads
 * `accessToken` on every attempt. See `specs/012-jwt-token-refresh/research.md`
 * R8 (storage and request plumbing) and R9 (boot, proactive renewal, dedup).
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  /** Wallclock (ms) the current access token expires; null while logged out. */
  const expiresAt = ref<number | null>(null);
  const user = ref<IAuthUser | null>(null);
  /** True after init() has run at least once (used by middleware to wait for hydration). */
  const isHydrated = ref(false);
  /**
   * The session could not be renewed while the person was working. `user` is
   * kept so the session-ended dialog can prefill the email; the token is gone.
   */
  const sessionEnded = ref(false);
  const sessionEndedCode = ref<string | null>(null);

  const isAuthenticated = computed(() => !!accessToken.value && !!user.value);
  const role = computed<UserRoleTypes | null>(() => user.value?.role ?? null);

  function hasRole(...required: UserRoleTypes[]): boolean {
    if (!required.length) return isAuthenticated.value;
    return required.some((r) => r === role.value);
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  /** Arm the proactive renewal 60 s before expiry; nothing when that is already past. */
  function scheduleRefresh() {
    clearRefreshTimer();
    if (!import.meta.client || expiresAt.value === null) return;
    const delay = expiresAt.value - Date.now() - REFRESH_BUFFER_MS;
    if (delay <= 0) return;
    refreshTimer = setTimeout(() => void refresh(), delay);
  }

  function dropToken() {
    clearRefreshTimer();
    accessToken.value = null;
    expiresAt.value = null;
  }

  function applySession(session: IAuthSession) {
    accessToken.value = session.accessToken;
    user.value = session.user;
    expiresAt.value = Date.now() + session.expiresIn * 1000;
    sessionEnded.value = false;
    sessionEndedCode.value = null;
    scheduleRefresh();
  }

  async function runRefresh(generation: number): Promise<boolean> {
    try {
      const session = await getService().refresh();
      if (generation !== refreshGeneration) return false;
      applySession(session);
      return true;
    } catch (err) {
      if (generation !== refreshGeneration) return false;
      if (isNetworkFailure(err)) {
        // The API never answered: the current token may still be good, so
        // keep it and try again shortly rather than ending the session.
        clearRefreshTimer();
        if (import.meta.client) {
          refreshTimer = setTimeout(() => void refresh(), NETWORK_RETRY_MS);
        }
        return false;
      }
      // A `SESSION_*` 401 (or anything else the API said): the token is not
      // coming back. At boot (no user yet) that simply means logged out; in
      // use it is the session-ended dialog, recorded with the API's own
      // reason so the api plugin's later `endSession(TOKEN_*)` is a no-op.
      dropToken();
      if (user.value) {
        const code = (err as { code?: unknown } | null)?.code;
        endSession(typeof code === 'string' ? code : null);
      }
      return false;
    }
  }

  /**
   * Renew the access token from the session cookie. Deduped: every caller
   * during one round-trip shares the same promise. Never throws; `false`
   * means "no new token" — the caller does not need to know why.
   */
  function refresh(): Promise<boolean> {
    if (!refreshInFlight) {
      const generation = refreshGeneration;
      refreshInFlight = runRefresh(generation).finally(() => {
        if (generation === refreshGeneration) refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  /**
   * Called when the tab becomes visible again: a throttled timer may have
   * slept past the buffer. Refresh if inside it, otherwise just re-arm.
   */
  async function ensureFresh(): Promise<void> {
    if (!isAuthenticated.value || expiresAt.value === null) return;
    if (expiresAt.value - Date.now() < REFRESH_BUFFER_MS) {
      await refresh();
      return;
    }
    scheduleRefresh();
  }

  async function fetchMe() {
    user.value = await getService().me();
    return user.value;
  }

  async function login(email: string, password: string) {
    const session = await getService().login(email, password);
    applySession(session);
    return session;
  }

  async function register(name: string, email: string, password: string) {
    const session = await getService().register(name, email, password);
    applySession(session);
    return session;
  }

  /**
   * Explicit sign-out: local state goes first so the UI reacts at once and a
   * refresh already in flight is discarded, then the server revokes the
   * session behind the cookie. A failed revoke is not the person's problem —
   * the cookie is gone from this tab's state either way.
   */
  async function logout(): Promise<void> {
    refreshGeneration += 1;
    refreshInFlight = null;
    dropToken();
    user.value = null;
    sessionEnded.value = false;
    sessionEndedCode.value = null;
    try {
      await getService().logout();
    } catch {
      // Ignored on purpose — see above.
    }
  }

  /**
   * The api plugin's verdict after a failed refresh-and-retry: the person was
   * in the middle of something, so keep the page and `user` and let the
   * session-ended dialog take over. Idempotent — concurrent 401s produce one
   * dialog, and the first code wins.
   */
  function endSession(code?: string | null): void {
    if (sessionEnded.value) return;
    dropToken();
    sessionEnded.value = true;
    sessionEndedCode.value = code ?? null;
  }

  /**
   * Boot: ask `/auth/refresh` for a token from the cookie alone. Success gives
   * token and user from the same response; failure (no cookie, expired,
   * unreachable) leaves the store logged out silently — nobody was in the
   * middle of anything yet. Called by the auth plugin before any guarded
   * navigation.
   */
  async function init(): Promise<void> {
    if (isHydrated.value) return;
    try {
      await refresh();
    } finally {
      isHydrated.value = true;
    }
  }

  return {
    accessToken,
    expiresAt,
    user,
    role,
    isHydrated,
    isAuthenticated,
    sessionEnded,
    sessionEndedCode,
    hasRole,
    init,
    login,
    register,
    logout,
    fetchMe,
    refresh,
    ensureFresh,
    endSession,
  };
});
