import { ErrorEntity } from '#error/domain/error.entity';
import { AuthErrorType } from './error.types';

/** 429 — rate-limited after too many failed attempts. */
export class TooManyAttemptsError extends ErrorEntity {
  constructor(message: string, options?: { statusCode?: number; isToast?: boolean }) {
    super(message, {
      statusCode: options?.statusCode ?? 429,
      isToast: options?.isToast ?? false,
      name: AuthErrorType.TOO_MANY_ATTEMPTS,
    });
  }
}
