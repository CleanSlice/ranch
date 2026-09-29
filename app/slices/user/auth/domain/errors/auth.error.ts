import { ErrorEntity } from '#error/domain/error.entity';

export interface IAuthErrorOptions {
  statusCode?: number;
  isToast?: boolean;
  code?: string;
  /** What the API said, exactly as it said it. */
  serverMessage?: string | null;
}

/**
 * An auth failure carries two things and keeps them apart.
 *
 * `messageKey` is what the console says for itself — an i18n key, so it reads
 * in the customer's language. `serverMessage` is what the API said, untouched:
 * it is shown as received in every language, because that is the text support
 * and the logs know the failure by.
 */
export class AuthError extends ErrorEntity {
  public readonly messageKey: string;
  public readonly serverMessage: string | null;

  constructor(messageKey: string, name: string, options: IAuthErrorOptions = {}) {
    super(messageKey, {
      statusCode: options.statusCode,
      isToast: options.isToast ?? false,
      name,
      code: options.code,
    });
    this.messageKey = messageKey;
    this.serverMessage = options.serverMessage ?? null;
  }
}
