/**
 * Whether entering the app at `path` restores the console session.
 *
 * Every console route does. The share page (`/share?token=…`) does not: it is
 * a visitor page that happens to be served by this app, and whoever opens it
 * is talking to the agent as a visitor even when the same browser is signed
 * in to the console. Asking `/auth/refresh` there would renew and rotate the
 * owner's session from a page that never uses it (CLEAN-239).
 */
const VISITOR_PATH = '/share';

export function restoresSession(path: string): boolean {
  return path !== VISITOR_PATH && !path.startsWith(`${VISITOR_PATH}/`);
}
