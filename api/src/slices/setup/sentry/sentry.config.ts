import { resolveDsn, type ReportingConfig } from './sentry.rules';

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where this API reports. Every value comes from the installation's own
 * environment; with `SENTRY_DSN` unset the answer is "nowhere", which is the
 * state of every build that has not opted in (CLEAN-218).
 *
 * "Production" here means "running from a built image": the Dockerfile bakes
 * `RANCH_VERSION` in, and `bun run start:dev` has none. `NODE_ENV` cannot
 * say it — the live deployment runs with `NODE_ENV=dev`. The consoles ask
 * the same question with `import.meta.dev`.
 */
export function readReportingConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReportingConfig {
  const version = env.RANCH_VERSION?.trim() || '';
  return {
    project: 'api',
    dsn: resolveDsn(env.SENTRY_DSN),
    installation:
      env.SENTRY_INSTALLATION?.trim() ||
      hostOf(env.PUBLIC_API_URL) ||
      'unknown',
    release: version || '0.0.0',
    // `dev` is the Dockerfile's default for an image built without a version.
    production: version !== '' && version !== 'dev',
  };
}
