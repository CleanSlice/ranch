import { describe, expect, test } from 'bun:test';
import {
  captureSentryException,
  initSentry,
  setSentryScreen,
  setSentryUser,
  type SdkLoader,
} from './sentry.client';
import { readReportingConfig } from './sentry.config';

const DSN = 'https://key@tracker.test/1';
const pub = { sentryDsn: DSN, sentryProject: 'admin', ranchVersion: '0.3.80' };

/** A stand-in for `@sentry/vue` that records what the adapter does to it. */
function fakeSdk() {
  const calls: { name: string; arg: unknown }[] = [];
  const record = (name: string) => (arg: unknown, value?: unknown) => {
    calls.push({ name, arg: value === undefined ? arg : [arg, value] });
  };
  const sdk = {
    init: record('init'),
    captureException: record('captureException'),
    setUser: record('setUser'),
    setTag: record('setTag'),
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = (async () => {
    await gate;
    return sdk;
  }) as unknown as SdkLoader;
  return { calls, load, release };
}

describe('readReportingConfig', () => {
  test('a production build with a destination', () => {
    expect(readReportingConfig(pub, 'admin.ranch.test', false)).toEqual({
      project: 'admin',
      dsn: DSN,
      installation: 'admin.ranch.test',
      release: '0.3.80',
      production: true,
    });
  });

  test('a dev server is not production', () => {
    expect(readReportingConfig(pub, 'localhost', true).production).toBe(false);
  });

  test('an empty or placeholder destination is none', () => {
    expect(readReportingConfig({ sentryDsn: '' }, 'h', false).dsn).toBe(undefined);
    expect(
      readReportingConfig({ sentryDsn: 'https://key@example.com/1' }, 'h', false).dsn,
    ).toBe(undefined);
  });

  test('anything but admin is the app console', () => {
    expect(readReportingConfig({ sentryProject: 'app' }, 'h', false).project).toBe('app');
    expect(readReportingConfig({}, '', false)).toEqual({
      project: 'app',
      dsn: undefined,
      installation: 'unknown',
      release: '0.0.0',
      production: true,
    });
  });
});

// One ordered scenario: the adapter keeps module state, as it does in a tab.
describe('the adapter', () => {
  test('before init, capture and context are no-ops that do not throw', () => {
    captureSentryException(new Error('early'));
    setSentryUser('u1');
    setSentryScreen('/agents/:id');
    expect(true).toBe(true);
  });

  test('stays off in dev and without a destination, and loads nothing', async () => {
    let loads = 0;
    const load = (async () => {
      loads += 1;
      throw new Error('must not load');
    }) as unknown as SdkLoader;

    expect(await initSentry(readReportingConfig(pub, 'localhost', true), load)).toBe(false);
    expect(await initSentry(readReportingConfig({}, 'h', false), load)).toBe(false);
    expect(loads).toBe(0);
  });

  test('a loader that fails leaves reporting off', async () => {
    const load = (async () => {
      throw new Error('chunk missing');
    }) as unknown as SdkLoader;
    expect(await initSentry(readReportingConfig(pub, 'h', false), load)).toBe(false);
  });

  test('on: sends what was caught while loading, with the context set so far', async () => {
    const { calls, load, release } = fakeSdk();
    const started = initSentry(readReportingConfig(pub, 'admin.ranch.test', false), load);

    const boot = new Error('failed during boot');
    captureSentryException(boot);
    release();
    expect(await started).toBe(true);

    expect(calls.map((call) => call.name)).toEqual([
      'init',
      'setUser',
      'setTag',
      'captureException',
    ]);
    expect(calls[1]?.arg).toEqual({ id: 'u1' });
    expect(calls[2]?.arg).toEqual(['screen', '/agents/:id']);
    expect(calls[3]?.arg).toBe(boot);

    const options = calls[0]?.arg as {
      dsn: string;
      app?: unknown;
      tracesSampleRate?: unknown;
      integrations: (defaults: { name: string }[]) => { name: string }[];
    };
    expect(options.dsn).toBe(DSN);
    expect(options.app).toBe(undefined);
    expect(options.tracesSampleRate).toBe(undefined);
    expect(
      options.integrations([{ name: 'Dedupe' }, { name: 'BrowserSession' }]),
    ).toEqual([{ name: 'Dedupe' }]);

    // Sign-out clears the person.
    setSentryUser(null);
    expect(calls.at(-2)?.arg).toBe(null);

    const later = new Error('later');
    captureSentryException(later);
    expect(calls.at(-1)?.arg).toBe(later);
  });
});
