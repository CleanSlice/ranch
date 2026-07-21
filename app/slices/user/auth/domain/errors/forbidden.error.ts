import { ErrorEntity } from '#error/domain/error.entity';
import { AuthErrorType } from './error.types';

/** 403 — action not allowed (e.g. self-service registration disabled). */
export class ForbiddenError extends ErrorEntity {
  constructor(message: string, options?: { statusCode?: number; isToast?: boolean }) {
    super(message, {
      statusCode: options?.statusCode ?? 403,
      isToast: options?.isToast ?? false,
      name: AuthErrorType.FORBIDDEN,
    });
  }
}
