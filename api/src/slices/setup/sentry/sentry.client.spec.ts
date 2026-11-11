import {
  captureBackgroundError,
  captureProcessError,
  captureRequestError,
  initSentry,
} from './sentry.client';
import { readReportingConfig } from './sentry.config';

const DSN = 'https://key@tracker.test/1';

describe('readReportingConfig', () => {
  it('is off with nothing set', () => {
    expect(readReportingConfig({})).toEqual({
      project: 'api',
      dsn: undefined,
      installation: 'unknown',
      release: '0.0.0',
      production: false,
    });
  });

  it('is a built image only with a real version baked in', () => {
    const production = (env: NodeJS.ProcessEnv) =>
      readReportingConfig(env).production;
    expect(production({ RANCH_VERSION: '0.3.80' })).toBe(true);
    expect(production({ RANCH_VERSION: '0.0.0-abc1234' })).toBe(true);
    // The live deployment runs with NODE_ENV=dev; it must not switch this off.
    expect(production({ RANCH_VERSION: '0.3.80', NODE_ENV: 'dev' })).toBe(true);
    expect(production({ RANCH_VERSION: 'dev' })).toBe(false);
    expect(production({ RANCH_VERSION: ' ' })).toBe(false);
    expect(production({ NODE_ENV: 'production' })).toBe(false);
  });

  it('reads the destination, the release and the installation', () => {
    expect(
      readReportingConfig({
        SENTRY_DSN: ` ${DSN} `,
        RANCH_VERSION: '0.3.80',
        PUBLIC_API_URL: 'https://api.ranch.test/',
      }),
    ).toEqual({
      project: 'api',
      dsn: DSN,
      installation: 'api.ranch.test',
      release: '0.3.80',
      production: true,
    });
  });

  it('prefers an explicit installation label', () => {
    const config = readReportingConfig({
      SENTRY_INSTALLATION: 'ranch-prod',
      PUBLIC_API_URL: 'https://api.ranch.test',
    });
    expect(config.installation).toBe('ranch-prod');
  });

  it('survives a malformed public URL', () => {
    expect(readReportingConfig({ PUBLIC_API_URL: 'not a url' })).toMatchObject({
      installation: 'unknown',
    });
  });

  it('treats a placeholder destination as none', () => {
    const config = readReportingConfig({
      SENTRY_DSN: 'https://key@example.com/1',
    });
    expect(config.dsn).toBeUndefined();
  });
});

describe('initSentry', () => {
  it.each([
    ['local development', { NODE_ENV: 'dev', SENTRY_DSN: DSN }],
    ['tests', { NODE_ENV: 'test', SENTRY_DSN: DSN }],
    [
      'an image built without a version',
      { RANCH_VERSION: 'dev', SENTRY_DSN: DSN },
    ],
    ['a released image with no destination', { RANCH_VERSION: '0.3.80' }],
  ])('stays off in %s', (_name, env) => {
    expect(initSentry(env)).toBe(false);
  });
});

describe('capture before init', () => {
  it('is a no-op that never throws', () => {
    const err = new Error('boom');
    expect(() => {
      captureRequestError(err, { operation: 'GET /x' });
      captureBackgroundError(err, 'chat.insight');
      captureProcessError(err, 'unhandledRejection');
    }).not.toThrow();
  });
});
