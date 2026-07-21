import { ErrorEntity } from '#error/domain/error.entity';
import { AuthErrorType } from './error.types';

/** 401 on login/register — wrong email or password. */
export class BadCredentialsError extends ErrorEntity {
  constructor(message: string, options?: { statusCode?: number; isToast?: boolean }) {
    super(message, {
      statusCode: options?.statusCode ?? 401,
      isToast: options?.isToast ?? false,
      name: AuthErrorType.BAD_CREDENTIALS,
    });
  }
}
