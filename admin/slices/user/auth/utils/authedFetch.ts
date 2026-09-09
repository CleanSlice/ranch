import { useAuthStore } from '#auth/stores/auth';

/** 401 codes that mean "the bearer is dead, the session may not be". */
const REFRESHABLE_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID']);

function withBearer(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...init, headers };
}

async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * `fetch` with the same session rules the axios instance applies: the current
 * bearer from the auth store on every attempt, and on a 401 carrying
 * `TOKEN_EXPIRED` / `TOKEN_INVALID` one refresh followed by one retry. When
 * the refresh fails the store enters the session-ended state (the in-place
 * dialog) and the original 401 response is returned so callers keep their
 * existing "not ok" handling.
 *
 * Bodies are re-sent as given, so pass strings / FormData, not streams.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const authStore = useAuthStore();
  const first = await fetch(input, withBearer(init, authStore.accessToken));
  if (first.status !== 401) return first;

  const code = await readErrorCode(first);
  if (!code || !REFRESHABLE_CODES.has(code)) return first;

  const ok = await authStore.refresh();
  if (!ok || !authStore.accessToken) {
    authStore.endSession(code);
    return first;
  }
  return fetch(input, withBearer(init, authStore.accessToken));
}

/**
 * Bearer header for an XMLHttpRequest (uploads that need progress events).
 * Call `ensureFreshToken()` first so the token is not about to expire
 * mid-upload; XHR gets no retry.
 */
export function authedXhrHeaders(): Record<string, string> {
  const token = useAuthStore().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Renew the token if it is inside the refresh buffer, then hand it back. */
export async function ensureFreshToken(): Promise<string | null> {
  const authStore = useAuthStore();
  await authStore.ensureFresh();
  return authStore.accessToken;
}
