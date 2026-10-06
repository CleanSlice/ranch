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
      // Safe to store and show: never contains the address.
      error: string;
    };

/** Where a message goes. One implementation today; the seam for a second. */
export abstract class INotifier {
  abstract send(
    address: string,
    message: INotificationMessage,
  ): Promise<NotifyResultTypes>;
}
