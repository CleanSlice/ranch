import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Proxies between the client and this API whose `X-Forwarded-For` entry we
 * trust. Mazda's deployment has one: the AWS load balancer. Change it with
 * TRUSTED_PROXY_HOPS when the ingress in front of the API changes; 0 means
 * the API is reached directly.
 */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * Reads TRUSTED_PROXY_HOPS. Unset or empty means the default. Anything that is
 * not a whole number of zero or more fails at boot instead of falling back:
 * a wrong count either puts every client behind one address or lets a client
 * pick its own.
 */
export function resolveTrustedProxyHops(raw: string | undefined): number {
  const value = raw?.trim() ?? '';
  if (value === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `TRUSTED_PROXY_HOPS must be a whole number, 0 or more; got "${raw}"`,
    );
  }
  return Number(value);
}

/**
 * Makes `req.ip` the real client address behind the proxies. Without it every
 * request looks like it comes from the balancer, so per-IP limits share one
 * bucket. Express takes the entries the trusted hops appended and ignores
 * anything the client put further left in `X-Forwarded-For`.
 */
export function trustLoadBalancer(
  app: NestExpressApplication,
  raw: string | undefined = process.env.TRUSTED_PROXY_HOPS,
): void {
  app.set('trust proxy', resolveTrustedProxyHops(raw));
}
