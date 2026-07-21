import { ErrorEntity } from '#error/domain/error.entity';
import { AuthErrorType } from './error.types';

/** Fallback — network failures and unrecognized server errors. */
export class UnknownAuthError extends ErrorEntity {
  constructor(message: string, options?: { statusCode?: number; isToast?: boolean }) {
    super(message, {
      statusCode: options?.statusCode ?? 500,
      isToast: options?.isToast ?? false,
      name: AuthErrorType.UNKNOWN_AUTH_ERROR,
    });
  }
}
