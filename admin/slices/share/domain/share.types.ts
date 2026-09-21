// Domain types for the admin share slice. Envelope-free; the data layer maps
// the API's `ShareLinkDto` onto these.
//
// Admin is a second place to manage the link the app console already manages
// (CLEAN-66): same endpoints, same state. Only the owner side lives here — the
// visitor page (`/share?token=…`) exists in the app and nowhere else.

/**
 * What the operator sees for one agent: is it shared, and with which link.
 *
 * `token` is only ever set while `active` — a revoked link keeps no secret.
 * `url` points at the *app* console, never at admin, and is filled in by the
 * store: it is the one place that knows where the app lives.
 */
export interface IShareLinkState {
  active: boolean;
  token: string | null;
  url: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
}
