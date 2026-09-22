/**
 * Which address a share link should carry.
 *
 * The link used to be assembled straight from `window.location.origin`, which
 * names whichever host the console happened to be open on. That is fine while
 * a deployment answers on exactly one hostname and wrong the moment it does
 * not: Mazda's console is reachable at `dev-mazda-ai.mycoso.cloud` while its
 * public address is `ranch.dev-mazda-ai.mycoso.cloud`, so every link went out
 * a label short — reachable, but not the address anyone should be handed
 * (CLEAN-110).
 *
 * Three steps, in order:
 *   1. an explicitly configured base wins — that is what a deployment should
 *      set, and it needs no code change here;
 *   2. otherwise a rule for a known host, for installations that cannot set
 *      the env var;
 *   3. otherwise the current origin, unchanged.
 *
 * Step 3 is why this is safe to ship everywhere: an installation with neither
 * a configured base nor a matching rule behaves exactly as it did before.
 */

export interface IShareOriginRule {
  /** Tested against the full origin, e.g. `https://dev-mazda-ai.mycoso.cloud`. */
  match: RegExp;
  /** Replacement for the whole origin; `$1`, `$2` … are groups of `match`. */
  publicOrigin: string;
}

/**
 * Known hosts whose console address is not their public address.
 *
 * First match wins, so a more specific entry belongs above a broader one. Add
 * a deployment by adding a line — prefer setting the env var instead, and keep
 * this for the cases where that is not available.
 */
export const SHARE_ORIGIN_RULES: IShareOriginRule[] = [
  // Mazda serves the console on the bare domain and publishes it under a
  // `ranch.` label. Dev and production differ only by the `dev-` prefix, so
  // one rule covers both; the scheme is captured rather than assumed so a
  // local http:// host is not silently rewritten to https://.
  {
    match: /^(https?:\/\/)((?:dev-)?mazda-ai\.mycoso\.cloud)$/,
    publicOrigin: '$1ranch.$2',
  },
];

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * @param currentOrigin   the browser's own origin, `window.location.origin`
 * @param configuredBase  `runtimeConfig.public.shareBaseUrl`, empty when unset
 * @param rules           overridable so a test can state its own table
 */
export function resolveShareOrigin(
  currentOrigin: string,
  configuredBase?: string | null,
  rules: IShareOriginRule[] = SHARE_ORIGIN_RULES,
): string {
  const configured = withoutTrailingSlash((configuredBase ?? '').trim());
  if (configured) return configured;

  const origin = withoutTrailingSlash(currentOrigin.trim());
  for (const rule of rules) {
    if (rule.match.test(origin)) {
      return withoutTrailingSlash(origin.replace(rule.match, rule.publicOrigin));
    }
  }
  return origin;
}

/** The full link handed to whoever the agent is being shared with. */
export function buildShareUrl(
  currentOrigin: string,
  token: string,
  configuredBase?: string | null,
  rules?: IShareOriginRule[],
): string {
  const origin = resolveShareOrigin(currentOrigin, configuredBase, rules);
  return `${origin}/share?token=${token}`;
}
