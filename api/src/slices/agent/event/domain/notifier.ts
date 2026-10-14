import { SlackReactionTypes } from './agentEvent.types';

export interface INotificationMessage {
  /** Plain fallback: what a phone's lock screen shows. */
  text: string;
  blocks: unknown[];
}

export type NotifyResultTypes =
  | { ok: true }
  | {
      ok: false;
      // false ⇒ trying again cannot help (the address is wrong or revoked).
      retryable: boolean;
      // The destination's own "come back in", when it gave one.
      retryAfterMs?: number;
      // Safe to store and show: never contains the address or the token.
      error: string;
    };

/** Where a message goes through an incoming webhook: one call, one answer. */
export abstract class INotifier {
  abstract send(
    address: string,
    message: INotificationMessage,
  ): Promise<NotifyResultTypes>;
}

export interface ISlackBotCredentials {
  token: string;
  channelId: string;
}

export type PostResultTypes =
  | { ok: true; ts: string }
  | Extract<NotifyResultTypes, { ok: false }>;

/**
 * The bot transport (CLEAN-165): a message has an identity (`ts`), so the
 * incident's root can be replied to, rewritten and given a reaction. Three
 * calls the webhook cannot make, behind their own port — forcing them into
 * INotifier would give the webhook methods it cannot implement.
 */
export abstract class ISlackBotNotifier {
  /** Posts to the channel, or into the thread of `threadTs` when given. */
  abstract post(
    cred: ISlackBotCredentials,
    message: INotificationMessage,
    threadTs?: string,
  ): Promise<PostResultTypes>;

  /** Rewrites a message the bot posted. */
  abstract update(
    cred: ISlackBotCredentials,
    ts: string,
    message: INotificationMessage,
  ): Promise<NotifyResultTypes>;

  /**
   * Leaves exactly one of the bot's reactions on the message: removes
   * `previous` (when given and different), adds `name`. "Already there" and
   * "was not there" are not errors.
   */
  abstract setReaction(
    cred: ISlackBotCredentials,
    ts: string,
    name: SlackReactionTypes,
    previous: SlackReactionTypes | null,
  ): Promise<NotifyResultTypes>;
}
