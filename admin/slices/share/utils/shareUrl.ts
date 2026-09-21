/** Port `app` listens on under `ranch dev` (`app/package.json`). */
const DEV_APP_PORT = 3000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Admin is served from `admin.<domain>`, the app from `<domain>` itself
 *  (`terraform/modules/apps/main.tf`: `admin_host` / `app_host`). */
const ADMIN_HOST_PREFIX = 'admin.';

/**
 * Where the app console lives, as an origin with no trailing slash — or `null`
 * when admin has no way to know.
 *
 * A share link only means something in the app: `/share` is an app page, and
 * admin has no such route. The app reads its own address bar for this; admin
 * works it out from its own address instead, so a standard deployment needs
 * no setting at all:
 *
 * - `admin.<domain>` → `<domain>`, the layout terraform deploys;
 * - localhost → the app's fixed dev port.
 *
 * `NUXT_PUBLIC_APP_URL` overrides both, for an install that puts the app
 * somewhere else (`app.<domain>`, a sub-path). Anything that fits neither rule
 * is `null`: a wrong guess is a link that looks fine and opens nothing, so the
 * panel says it cannot build one instead.
 */
export function resolveAppOrigin(
  configured: string | null | undefined,
  adminOrigin: string | null | undefined,
): string | null {
  const explicit = toHttpBase(configured);
  if (explicit) return explicit;

  const admin = toUrl(adminOrigin);
  if (!admin) return null;
  if (LOCAL_HOSTS.has(admin.hostname)) {
    return `${admin.protocol}//${admin.hostname}:${DEV_APP_PORT}`;
  }
  if (admin.hostname.startsWith(ADMIN_HOST_PREFIX)) {
    const appHost = admin.host.slice(ADMIN_HOST_PREFIX.length);
    // `admin.com` is somebody's whole domain, not an admin subdomain of `com`.
    if (appHost.includes('.')) return `${admin.protocol}//${appHost}`;
  }
  return null;
}

/** The link a visitor opens; the same shape the app console hands out. */
export function buildShareUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/share?token=${encodeURIComponent(token)}`;
}

function toUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Accepts only http(s); keeps a sub-path if the app is served under one. */
function toHttpBase(value: string | null | undefined): string | null {
  const url = toUrl(value?.trim());
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return null;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
