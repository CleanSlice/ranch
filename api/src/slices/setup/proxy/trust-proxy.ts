import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Proxies between the client and this API whose `X-Forwarded-For` entry we
 * trust. On the Mazda deployment that is the AWS load balancer and nothing
 * else. Change it only together with the ingress in front of the API.
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * Makes `req.ip` the real client address behind the load balancer. Without it
 * every request looks like it comes from the balancer, so per-IP limits share
 * one bucket. Express then takes the entry the balancer appended and ignores
 * anything the client put further left in `X-Forwarded-For`.
 */
export function trustLoadBalancer(app: NestExpressApplication): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}
