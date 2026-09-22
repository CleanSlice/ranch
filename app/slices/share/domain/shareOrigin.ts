/**
 * Where a share link points, and how it is spelled.
 *
 * `/share` is a page of this console, so the app can normally answer from its
 * own address bar — unlike admin, which has to work the app's address out from
 * its own (`admin/slices/share/utils/shareUrl.ts`).
 *
 * The address bar is still only a default. A deployment can answer on more
 * than one hostname, and the link has to carry the published one: Mazda's
 * console is reachable at `dev-mazda-ai.mycoso.cloud` while it is published
 * under `ranch.dev-mazda-ai.mycoso.cloud`, so links built from the address bar
 * went out a label short (CLEAN-110).
 *
 * `NUXT_PUBLIC_APP_URL` settles it. Deliberately the same variable the admin
 * console reads: one name for one idea, so nobody has to know which console
 * they are configuring. An install with the app somewhere unusual sets it once
 * and both consoles agree (CLEAN-111).
 */

/** Accepts only http(s); keeps a sub-path if the app is served under one. */
function toHttpBase(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * @param configured  `runtimeConfig.public.appUrl`, empty when unset
 * @param ownOrigin   this console's own address, `window.location.origin`
 *
 * Returns `null` only when there is genuinely nothing to build from — during
 * SSR, where there is no address bar and no configured value.
 */
export function resolveAppOrigin(
  configured: string | null | undefined,
  ownOrigin: string | null | undefined,
): string | null {
  return toHttpBase(configured) ?? toHttpBase(ownOrigin);
}

/**
 * The link a visitor opens.
 *
 * Kept byte-identical to the admin console's `buildShareUrl`, including the
 * token encoding — the two used to differ, and a link that works from one
 * console and not the other is the worst kind of bug to be told about.
 */
export function buildShareUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/share?token=${encodeURIComponent(token)}`;
}
