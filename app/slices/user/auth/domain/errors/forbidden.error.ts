import { AuthError, type IAuthErrorOptions } from './auth.error';
import { AuthErrorType } from './error.types';

/** 403 — action not allowed (e.g. self-service registration disabled). */
export class ForbiddenError extends AuthError {
  constructor(messageKey: string, options?: IAuthErrorOptions) {
    super(messageKey, AuthErrorType.FORBIDDEN, {
      ...options,
      statusCode: options?.statusCode ?? 403,
    });
  }
}
