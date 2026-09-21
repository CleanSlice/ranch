/** Port `app` listens on under `ranch dev` (`app/package.json`). */
const DEV_APP_PORT = 3000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Where the app console lives, as an origin with no trailing slash — or `null`
 * when admin has no way to know.
 *
 * A share link only means something in the app: `/share` is an app page, and
 * admin has no such route. So unlike the app, which can read its own address
 * bar, admin has to be told (`NUXT_PUBLIC_APP_URL`).
 *
 * The only guess made is for local dev, where the app's port is fixed. In a
 * deployment the two hosts follow no rule admin could rely on (`app.<domain>`
 * in one setup, the bare domain in another), and a wrong guess is a link that
 * looks fine and opens nothing — so there it is `null`, and the panel says the
 * setting is missing instead.
 */
export function resolveAppOrigin(
  configured: string | null | undefined,
  adminOrigin: string | null | undefined,
): string | null {
  const explicit = toHttpBase(configured);
  if (explicit) return explicit;

  const admin = toUrl(adminOrigin);
  if (admin && LOCAL_HOSTS.has(admin.hostname)) {
    return `${admin.protocol}//${admin.hostname}:${DEV_APP_PORT}`;
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
