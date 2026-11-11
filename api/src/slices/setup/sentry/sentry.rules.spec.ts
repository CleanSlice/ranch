import { HttpException } from '@nestjs/common';

import {
  MAX_EVENTS_PER_MINUTE,
  buildInitOptions,
  createBeforeSend,
  decide,
  isReportingEnabled,
  resolveDsn,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
  type ReportingConfig,
  type SentryEventLike,
} from './sentry.rules';

const config = (over: Partial<ReportingConfig> = {}): ReportingConfig => ({
  dsn: 'https://key@tracker.test/1',
  project: 'api',
  installation: 'ranch.test',
  release: '1.2.3',
  production: true,
  ...over,
});

/** What the consoles hand over: their ErrorEntity, by shape. */
const entity = (statusCode: number, over: Record<string, unknown> = {}) =>
  Object.assign(new Error('boom'), {
    statusCode,
    isToast: true,
    code: '',
    title: 'boom_title',
    ...over,
  });

const watchTimeout = () => new DOMException('timed out', 'TimeoutError');

describe('resolveDsn', () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    ['', undefined],
    ['   ', undefined],
    ['https://key@example.com/1', undefined],
    [' https://key@tracker.test/1 ', 'https://key@tracker.test/1'],
  ])('%p -> %p', (raw, expected) => {
    expect(resolveDsn(raw)).toBe(expected);
  });
});

describe('isReportingEnabled', () => {
  it('needs production and a destination', () => {
    expect(isReportingEnabled(config())).toBe(true);
    expect(isReportingEnabled(config({ production: false }))).toBe(false);
    expect(isReportingEnabled(config({ dsn: undefined }))).toBe(false);
  });
});

describe('decide', () => {
  it('1. ignores the Kubernetes watch timeout, in the API only', () => {
    expect(decide(watchTimeout(), 'api')).toMatchObject({
      report: false,
      reason: 'ignored',
    });
    expect(decide(watchTimeout(), 'admin')).toMatchObject({
      report: true,
      reason: 'unknown',
    });
  });

  it.each([
    'Failed to fetch dynamically imported module: /_nuxt/a.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /_nuxt/a.css',
  ])('2. drops a stale chunk in a console: %s', (message) => {
    expect(decide(new TypeError(message), 'app')).toMatchObject({
      report: false,
      reason: 'stale-chunk',
    });
    expect(decide(new TypeError(message), 'api').report).toBe(true);
  });

  it.each(['ERR_NETWORK', 'ERR_CANCELED'])(
    '3. drops the browser environment code %s in a console',
    (code) => {
      // The mapper gives a request with no response status 500 — the code
      // must win over the status.
      expect(decide(entity(500, { code }), 'admin')).toMatchObject({
        report: false,
        reason: 'environment',
      });
    },
  );

  it('3. an outbound network failure in the API is a real failure', () => {
    const err = Object.assign(new Error('down'), { code: 'ERR_NETWORK' });
    expect(decide(err, 'api')).toMatchObject({ report: true });
  });

  it('4. never reports "not signed in"', () => {
    expect(decide(entity(401), 'app')).toMatchObject({
      report: false,
      reason: 'unauthorized',
    });
    expect(decide(new HttpException('no', 401), 'api')).toMatchObject({
      report: false,
      reason: 'unauthorized',
    });
  });

  it.each([400, 403, 404, 409, 422, 499])(
    '5. drops an expected %i',
    (status) => {
      expect(decide(entity(status), 'admin')).toMatchObject({
        report: false,
        reason: 'expected',
      });
      expect(decide(new HttpException('no', status), 'api')).toMatchObject({
        report: false,
        reason: 'expected',
      });
    },
  );

  it('5. reads the status of a raw client error from its response', () => {
    const err = Object.assign(new Error('Request failed'), {
      response: { status: 404 },
    });
    expect(decide(err, 'app')).toMatchObject({
      report: false,
      reason: 'expected',
    });
  });

  it('6. reports a server failure with status, code and title', () => {
    expect(decide(entity(503, { code: 'UPSTREAM_DOWN' }), 'admin')).toEqual({
      report: true,
      reason: 'server-failure',
      tags: { statusCode: '503', errorCode: 'UPSTREAM_DOWN' },
      extra: { title: 'boom_title' },
    });
  });

  it('6. leaves out an empty code and a missing title', () => {
    expect(decide(new HttpException('down', 500), 'api')).toEqual({
      report: true,
      reason: 'server-failure',
      tags: { statusCode: '500' },
      extra: {},
    });
  });

  it.each([[new Error('plain')], ['a string'], [undefined], [null], [42]])(
    '7. reports anything unknown: %p',
    (err) => {
      expect(decide(err, 'api')).toEqual({
        report: true,
        reason: 'unknown',
        tags: {},
        extra: {},
      });
    },
  );
});

describe('scrubEvent', () => {
  const SENSITIVE = [
    'password',
    'passwd',
    'token',
    'secret',
    'authorization',
    'cookie',
    'set-cookie',
    'email',
    'phone',
    'auth_token',
    'access_token',
    'refresh_token',
    'api_key',
    'apikey',
    'x-api-key',
    'session',
    'ranch_session',
    'jwt',
    'dsn',
  ];

  it.each(SENSITIVE)('filters %s in headers, extra and contexts', (key) => {
    const upper = key.toUpperCase();
    const event = scrubEvent({
      request: { headers: { [key]: 'v', [upper]: 'v', accept: 'json' } },
      extra: { [key]: 'v', nested: { deep: [{ [key]: 'v', keep: 1 }] } },
      contexts: { app: { [key]: 'v', name: 'ranch' } },
    });

    expect(event.request?.headers).toEqual({
      [key]: '[Filtered]',
      [upper]: '[Filtered]',
      accept: 'json',
    });
    expect(event.extra).toEqual({
      [key]: '[Filtered]',
      nested: { deep: [{ [key]: '[Filtered]', keep: 1 }] },
    });
    expect(event.contexts).toEqual({
      app: { [key]: '[Filtered]', name: 'ranch' },
    });
  });

  it('deletes the request body and cookies outright', () => {
    const event = scrubEvent({
      request: { data: { text: 'hello agent' }, cookies: { a: 'b' } },
    });
    expect(event.request).toEqual({});
  });

  it('filters sensitive query parameters and keeps the rest', () => {
    const event = scrubEvent({
      request: {
        url: 'https://ranch.test/share?token=abc&chat=42#top',
        query_string: 'token=abc&chat=42',
      },
    });
    expect(event.request?.url).toBe(
      'https://ranch.test/share?token=[Filtered]&chat=42#top',
    );
    expect(event.request?.query_string).toBe('token=[Filtered]&chat=42');
  });

  it('drops a query string it cannot read as text', () => {
    const event = scrubEvent({ request: { query_string: { token: 'abc' } } });
    expect(event.request).toEqual({});
  });

  it('reduces the user to an id', () => {
    const event = scrubEvent({
      user: { id: 'u1', email: 'a@b.c', username: 'ann', ip_address: '::1' },
    });
    expect(event.user).toEqual({ id: 'u1' });
  });

  it('drops a user with no id', () => {
    const event = scrubEvent({ user: { email: 'a@b.c' } });
    expect(event.user).toBeUndefined();
  });

  it('cuts nesting it will not walk', () => {
    let deep: Record<string, unknown> = { password: 'p' };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const flat = JSON.stringify(scrubEvent({ extra: deep }).extra);
    expect(flat).not.toContain('"p"');
  });
});

describe('scrubEvent on what Ranch actually carries', () => {
  it('a failed chat request leaves no message text', () => {
    const event = scrubEvent({
      request: {
        url: 'https://api.ranch.test/agents/a1/chat',
        data: { message: 'my card number is 4111' },
        headers: {
          Authorization: 'Bearer eyJhbGciOi',
          cookie: 'ranch_session=s3cret',
          'content-type': 'application/json',
        },
        cookies: { ranch_session: 's3cret' },
      },
    });
    const flat = JSON.stringify(event);
    expect(flat).not.toContain('4111');
    expect(flat).not.toContain('eyJhbGciOi');
    expect(flat).not.toContain('s3cret');
    expect(event.request?.headers).toEqual({
      Authorization: '[Filtered]',
      cookie: '[Filtered]',
      'content-type': 'application/json',
    });
  });

  it('a provider credential in extra is filtered', () => {
    const event = scrubEvent({
      extra: { provider: { name: 'anthropic', apiKey: 'sk-ant-123' } },
    });
    expect(JSON.stringify(event)).not.toContain('sk-ant-123');
    expect(event.extra).toEqual({
      provider: { name: 'anthropic', apiKey: '[Filtered]' },
    });
  });

  it('a share link keeps its address and loses its token', () => {
    expect(scrubUrl('https://ranch.test/share?token=tok_1&agent=a1')).toBe(
      'https://ranch.test/share?token=[Filtered]&agent=a1',
    );
    expect(scrubUrl('/agents/a1')).toBe('/agents/a1');
  });
});

describe('scrubText', () => {
  it.each([
    [
      'a database URL with its password',
      "Can't reach database server at postgresql://ranch:s3cretPw@db.internal:5432/ranch",
      "Can't reach database server at postgresql://[Filtered]@db.internal:5432/ranch",
    ],
    [
      'a link with a token in its query',
      'GET https://ranch.test/share?token=tok_1&agent=a1 failed with 502',
      'GET https://ranch.test/share?token=[Filtered]&agent=a1 failed with 502',
    ],
    [
      'an echoed bearer header',
      'upstream said: Authorization: Bearer eyJhbGciOi.abc.def',
      'upstream said: Authorization: [Filtered] [Filtered]',
    ],
    [
      'a bare bearer token',
      'rejected Bearer eyJhbGciOi.abc.def by gateway',
      'rejected Bearer [Filtered] by gateway',
    ],
    [
      'a key in a JSON-ish dump',
      'bad config {"apiKey":"abc123","model":"fable"}',
      'bad config {"apiKey":"[Filtered]","model":"fable"}',
    ],
    [
      'a provider key on its own',
      'provider rejected sk-ant-api03-AbCdEf123456',
      'provider rejected [Filtered]',
    ],
    [
      'an email',
      'no user ann.lee@ranch.test in workspace',
      'no user [Filtered] in workspace',
    ],
    [
      'a password assignment',
      'login failed for password=hunter2 on attempt 3',
      'login failed for password=[Filtered] on attempt 3',
    ],
  ])('masks %s', (_name, input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    'Cannot read properties of undefined (reading "id")',
    'Unexpected token } in JSON at position 12',
    'Workflow submit failed for agent a-42: 503 Service Unavailable',
    'GET https://api.ranch.test/agents/a-42 failed with 500',
  ])('leaves an ordinary message alone: %s', (message) => {
    expect(scrubText(message)).toBe(message);
  });
});

describe('scrubEvent on the error text itself', () => {
  it('masks every exception in the chain and the event message', () => {
    const event = scrubEvent({
      message: 'failed for ann@ranch.test',
      exception: {
        values: [
          { value: 'connect postgresql://ranch:pw@db/ranch refused' },
          { value: 'deploy failed: token=abc123' },
          { value: 42 },
          {},
        ],
      },
    });
    expect(event.message).toBe('failed for [Filtered]');
    expect(event.exception?.values).toEqual([
      { value: 'connect postgresql://[Filtered]@db/ranch refused' },
      { value: 'deploy failed: token=[Filtered]' },
      { value: 42 },
      {},
    ]);
  });
});

describe('scrubBreadcrumb', () => {
  it('masks a breadcrumb message', () => {
    expect(
      scrubBreadcrumb({ category: 'ui.input', message: 'a@b.co typed' }),
    ).toEqual({ category: 'ui.input', message: '[Filtered] typed' });
  });

  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console' })).toBeNull();
  });

  it('filters addresses in the rest', () => {
    expect(
      scrubBreadcrumb({
        category: 'xhr',
        data: { url: '/auth/refresh?token=abc', status_code: 200 },
      }),
    ).toEqual({
      category: 'xhr',
      data: { url: '/auth/refresh?token=[Filtered]', status_code: 200 },
    });
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/a?jwt=1', to: '/b' },
      }),
    ).toEqual({
      category: 'navigation',
      data: { from: '/a?jwt=[Filtered]', to: '/b' },
    });
  });
});

describe('createBeforeSend', () => {
  const hint = (originalException: unknown) => ({ originalException });

  it('drops what the rules drop', () => {
    const beforeSend = createBeforeSend('admin');
    expect(beforeSend({}, hint(entity(401)))).toBeNull();
    expect(beforeSend({}, hint(entity(400)))).toBeNull();
  });

  it('labels and scrubs what it lets through', () => {
    const beforeSend = createBeforeSend('admin');
    const event: SentryEventLike = {
      tags: { screen: '/agents/:id' },
      user: { id: 'u1', email: 'a@b.c' },
      extra: { token: 't' },
    };
    expect(beforeSend(event, hint(entity(500, { code: 'X' })))).toEqual({
      tags: { screen: '/agents/:id', statusCode: '500', errorCode: 'X' },
      user: { id: 'u1' },
      extra: { token: '[Filtered]', title: 'boom_title' },
    });
  });

  it('lets an event with no hint through as unknown', () => {
    expect(createBeforeSend('api')({ tags: {} })).toEqual({ tags: {} });
  });

  it(`drops event ${MAX_EVENTS_PER_MINUTE + 1} inside a minute, then recovers`, () => {
    let at = 1_000_000;
    const beforeSend = createBeforeSend('api', () => at);
    for (let i = 0; i < MAX_EVENTS_PER_MINUTE; i++) {
      at += 100;
      expect(beforeSend({}, hint(new Error('loop')))).not.toBeNull();
    }
    at += 100;
    expect(beforeSend({}, hint(new Error('loop')))).toBeNull();

    at += 60_000;
    expect(beforeSend({}, hint(new Error('loop')))).not.toBeNull();
  });

  it('drops the event when scrubbing throws', () => {
    const event = {} as SentryEventLike;
    Object.defineProperty(event, 'request', {
      get() {
        throw new Error('hostile getter');
      },
    });
    expect(createBeforeSend('api')(event, hint(new Error('x')))).toBeNull();
  });
});

describe('buildInitOptions', () => {
  it('carries the destination, the labels and both gates, and no tracing', () => {
    const options = buildInitOptions(config({ project: 'app' }));
    expect(options).toMatchObject({
      dsn: 'https://key@tracker.test/1',
      sendDefaultPii: false,
      environment: 'production',
      release: '1.2.3',
      initialScope: { tags: { project: 'app', installation: 'ranch.test' } },
    });
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(
      options.beforeSend({}, { originalException: entity(401) }),
    ).toBeNull();
  });
});
