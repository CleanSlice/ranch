import { resolveDsn, type ReportingConfig } from './sentry.rules';

/** The three `runtimeConfig.public` values this slice reads. */
export interface SentryPublicConfig {
  sentryDsn?: unknown;
  sentryProject?: unknown;
  ranchVersion?: unknown;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Where this console reports. Pure: the caller passes the runtime config,
 * the hostname and whether this is a dev server, so it runs in a test.
 */
export function readReportingConfig(
  pub: SentryPublicConfig,
  hostname: string,
  dev: boolean,
): ReportingConfig {
  return {
    project: pub.sentryProject === 'admin' ? 'admin' : 'app',
    dsn: resolveDsn(text(pub.sentryDsn)),
    // The address the console is served from names the installation for free.
    installation: hostname.trim() || 'unknown',
    release: text(pub.ranchVersion) || '0.0.0',
    production: !dev,
  };
}
