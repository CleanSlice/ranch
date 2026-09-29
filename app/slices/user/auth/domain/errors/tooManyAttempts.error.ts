import { AuthError, type IAuthErrorOptions } from './auth.error';
import { AuthErrorType } from './error.types';

/** 429 — rate-limited after too many failed attempts. */
export class TooManyAttemptsError extends AuthError {
  constructor(messageKey: string, options?: IAuthErrorOptions) {
    super(messageKey, AuthErrorType.TOO_MANY_ATTEMPTS, {
      ...options,
      statusCode: options?.statusCode ?? 429,
    });
  }
}
