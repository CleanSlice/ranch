import { IUserBrowserStatePayload } from './browserState.types';

/**
 * Per-user storageState store. Holds Playwright-shaped cookie blobs
 * imported from the Ranch extension (or pasted manually from any
 * Cookie-Editor flow) so the runtime can replay a logged-in session
 * without going through the browser-pool VNC dance.
 *
 * Storage layout (S3): `users/<userId>/browser-state/<profile>.json`.
 * The runtime falls back to this when no per-agent state file exists,
 * so a single import covers every agent the user owns.
 *
 * `profile` is the same identifier passed to `browser_play` — for
 * integration accounts it is composed as `<service>:<accountKey>`
 * (e.g. `instagram:miybot`).
 */
export abstract class IUserBrowserStateGateway {
  abstract get(
    userId: string,
    profile: string,
  ): Promise<IUserBrowserStatePayload | null>;

  abstract set(
    userId: string,
    profile: string,
    payload: IUserBrowserStatePayload,
  ): Promise<void>;

  abstract delete(userId: string, profile: string): Promise<void>;
}
