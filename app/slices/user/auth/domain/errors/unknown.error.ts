import { AuthError, type IAuthErrorOptions } from './auth.error';
import { AuthErrorType } from './error.types';

/**
 * Fallback — network failures and unrecognized server errors. Also the shape
 * of a session-level 401 (`SESSION_*` / `TOKEN_*`), which carries the API's
 * machine-readable `code` for the auth store.
 */
export class UnknownAuthError extends AuthError {
  constructor(messageKey: string, options?: IAuthErrorOptions) {
    super(messageKey, AuthErrorType.UNKNOWN_AUTH_ERROR, {
      ...options,
      statusCode: options?.statusCode ?? 500,
    });
  }
}
