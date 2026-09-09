import type { IErrorMapper } from '#common/data/BaseGateway';
import type { ErrorEntity } from '#error/domain/error.entity';
import { BadCredentialsError } from '../domain/errors/badCredentials.error';
import { ForbiddenError } from '../domain/errors/forbidden.error';
import { TooManyAttemptsError } from '../domain/errors/tooManyAttempts.error';
import { UnknownAuthError } from '../domain/errors/unknown.error';

interface AxiosLikeError {
  code?: string;
  message?: string;
  response?: { status?: number; data?: unknown };
  /** `@hey-api/client-axios` copies `response.data` here on a non-throwing error. */
  error?: unknown;
}

/**
 * Translates a raw auth API failure into a typed domain error with a
 * user-facing message. The `#api` client is axios-based, so error bodies live
 * on `error.response.data` (main-site's ofetch client uses `_data` instead).
 *
 * Wired into `AuthGateway` via `BaseGateway`'s constructor — every gateway
 * method that throws is funneled through here.
 */
export class AuthErrorMapper implements IErrorMapper {
  toErrorEntity(error: unknown): ErrorEntity {
    const e = (error ?? {}) as AxiosLikeError;
    const status = e.response?.status ?? 0;
    const body = e.response?.data ?? e.error;
    const serverMessage = pickMessage(body);
    const code = pickCode(body);

    if (e.code === 'ERR_NETWORK' || status === 0) {
      return new UnknownAuthError(
        'Network error — check your connection and try again.',
        { statusCode: 0 },
      );
    }
    if (status === 401) {
      // A 401 with a machine-readable code is the API talking about the
      // session (`SESSION_*` from /auth/refresh) or the token (`TOKEN_*` from
      // /auth/me), never about the credentials just typed. The store reads
      // `code`; a login/register 401 stays "wrong email or password".
      if (isSessionCode(code)) {
        return new UnknownAuthError(serverMessage ?? 'Your session has ended.', {
          statusCode: 401,
          code,
        });
      }
      return new BadCredentialsError('Incorrect email or password.', { code });
    }
    if (status === 429) {
      return new TooManyAttemptsError(
        'Too many attempts. Please wait a moment and try again.',
      );
    }
    if (status === 403) {
      return new ForbiddenError(
        serverMessage ?? 'You don’t have access to do that.',
      );
    }
    return new UnknownAuthError(
      serverMessage ?? 'Something went wrong. Please try again.',
      { statusCode: status || 500, code },
    );
  }
}

/** The 401 `code` the API sets on every guarded route and on `/auth/refresh` (CLEAN-72). */
function pickCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as Record<string, unknown>).code;
  return typeof raw === 'string' && raw ? raw : undefined;
}

function isSessionCode(code: string | undefined): code is string {
  return !!code && (code.startsWith('SESSION_') || code.startsWith('TOKEN_'));
}

/** Pull a human message out of the API error body (`message` / `detail` / `error`). */
function pickMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const raw = b.message ?? b.detail ?? b.error;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = raw.filter((x): x is string => typeof x === 'string');
    return parts.length ? parts.join(' ') : null;
  }
  return null;
}
