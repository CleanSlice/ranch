import { AuthError, type IAuthErrorOptions } from './auth.error';
import { AuthErrorType } from './error.types';

/** 401 on login/register — wrong email or password. */
export class BadCredentialsError extends AuthError {
  constructor(messageKey: string, options?: IAuthErrorOptions) {
    super(messageKey, AuthErrorType.BAD_CREDENTIALS, {
      ...options,
      statusCode: options?.statusCode ?? 401,
    });
  }
}
