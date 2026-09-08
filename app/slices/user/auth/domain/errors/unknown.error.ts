import { ErrorEntity } from '#error/domain/error.entity';
import { AuthErrorType } from './error.types';

/**
 * Fallback — network failures and unrecognized server errors. Also the shape
 * of a session-level 401 (`SESSION_*` / `TOKEN_*`), which carries the API's
 * machine-readable `code` for the auth store.
 */
export class UnknownAuthError extends ErrorEntity {
  constructor(
    message: string,
    options?: { statusCode?: number; isToast?: boolean; code?: string },
  ) {
    super(message, {
      statusCode: options?.statusCode ?? 500,
      isToast: options?.isToast ?? false,
      name: AuthErrorType.UNKNOWN_AUTH_ERROR,
      code: options?.code,
    });
  }
}
