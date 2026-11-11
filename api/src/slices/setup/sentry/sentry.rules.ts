/**
 * Error-tracking rules (CLEAN-218): what is reported, how it is labelled and
 * what is removed before an event leaves.
 *
 * This file exists three times, byte for byte:
 *   api/src/slices/setup/sentry/sentry.rules.ts
 *   admin/slices/setup/sentry/sentry.rules.ts
 *   app/slices/setup/sentry/sentry.rules.ts
 * Edit the API copy, copy it to both consoles in the same commit;
 * `scripts/sentry-twin.test.ts` fails CI when they differ.
 *
 * It imports nothing and reads no global, so the same text compiles under
 * NestJS and under Nuxt. The SDK lives in each project's `sentry.client.ts`.
 */

export type SentryProject = 'api' | 'admin' | 'app';

export interface ReportingConfig {
  dsn: string | undefined;
  project: SentryProject;
  installation: string;
  release: string;
  production: boolean;
}

export type DecisionReason =
  | 'ignored'
  | 'stale-chunk'
  | 'environment'
  | 'unauthorized'
  | 'expected'
  | 'server-failure'
  | 'unknown';

export interface Decision {
  report: boolean;
  reason: DecisionReason;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

/** The parts of an SDK event the rules touch. Structural, so no SDK import. */
export interface SentryEventLike {
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, unknown>;
    data?: unknown;
    cookies?: unknown;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

export interface SentryHintLike {
  originalException?: unknown;
}

export interface SentryBreadcrumbLike {
  category?: string;
  data?: Record<string, unknown>;
}

export interface SentryInitOptions {
  dsn: string | undefined;
  sendDefaultPii: false;
  environment: 'production';
  release: string;
  initialScope: { tags: Record<string, string> };
  beforeSend: <T extends SentryEventLike>(
    event: T,
    hint?: SentryHintLike,
  ) => T | null;
  beforeBreadcrumb: <T extends SentryBreadcrumbLike>(crumb: T) => T | null;
}

/**
 * 500 is the HTTP boundary between "the caller got it wrong" and "we did".
 * Same threshold as main-site's shouldReportToSentry.
 */
export const SERVER_FAILURE_STATUS = 500;

/**
 * Events allowed per rolling minute, per process or tab. A real incident is a
 * handful of distinct errors a minute; a failing render loop or a per-request
 * bug is thousands. Twenty is far above the first and far below the second.
 */
export const MAX_EVENTS_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;

const FILTERED = '[Filtered]';

const SENSITIVE_KEY =
  /^(password|passwd|token|secret|authorization|cookie|set-cookie|email|phone|auth_token|access_token|refresh_token|api_key|apikey|x-api-key|session|ranch_session|jwt|dsn)$/i;

/** A tab still running the previous release asks for a chunk that is gone. */
const STALE_CHUNK =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** The browser's own network: offline, navigated away, cancelled. */
const ENVIRONMENT_CODES = new Set(['ERR_NETWORK', 'ERR_CANCELED']);

/** Nesting deeper than this is cut rather than walked. */
const MAX_SCRUB_DEPTH = 8;

/** Treat an empty or placeholder DSN as "reporting is off". */
export function resolveDsn(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const dsn = raw.trim();
  if (!dsn || dsn.includes('example.com')) return undefined;
  return dsn;
}

export function isReportingEnabled(config: ReportingConfig): boolean {
  return config.production && config.dsn !== undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

/** The HTTP status an error carries, wherever its kind keeps it. */
function statusOf(err: Record<string, unknown>): number | undefined {
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (typeof err.getStatus === 'function') {
    try {
      const status: unknown = (err.getStatus as () => unknown).call(err);
      if (typeof status === 'number') return status;
    } catch {
      // A getter that throws tells us nothing; fall through.
    }
  }
  const response = asRecord(err.response);
  if (response && typeof response.status === 'number') return response.status;
  return undefined;
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  const record = asRecord(err);
  return record && typeof record.message === 'string' ? record.message : '';
}

/**
 * The Kubernetes watch leaks a DOMException TimeoutError after every ~5 min
 * server-side timeout; `api/src/main.ts` swallows it so the watch can
 * reconnect. Reported, it is ~288 events a day of something already handled.
 */
function isWatchTimeout(err: Record<string, unknown>): boolean {
  const ctor = err.constructor as { name?: unknown } | undefined;
  return err.name === 'TimeoutError' && ctor?.name === 'DOMException';
}

const drop = (reason: DecisionReason): Decision => ({
  report: false,
  reason,
  tags: {},
  extra: {},
});

/** Report or drop one error. First matching rule wins. */
export function decide(err: unknown, project: SentryProject): Decision {
  const record = asRecord(err);

  if (project === 'api' && record && isWatchTimeout(record)) {
    return drop('ignored');
  }

  if (project !== 'api') {
    if (STALE_CHUNK.test(messageOf(err))) return drop('stale-chunk');
    if (record && ENVIRONMENT_CODES.has(String(record.code))) {
      return drop('environment');
    }
  }

  const status = record ? statusOf(record) : undefined;
  if (record && status !== undefined) {
    if (status === 401) return drop('unauthorized');
    if (status < SERVER_FAILURE_STATUS) return drop('expected');

    const tags: Record<string, string> = { statusCode: String(status) };
    const code = record.code;
    if (typeof code === 'number' || (typeof code === 'string' && code)) {
      tags.errorCode = String(code);
    }
    const extra: Record<string, unknown> = {};
    if (typeof record.title === 'string' && record.title) {
      extra.title = record.title;
    }
    return { report: true, reason: 'server-failure', tags, extra };
  }

  return { report: true, reason: 'unknown', tags: {}, extra: {} };
}

function scrubValue(key: string, value: unknown, depth: number): unknown {
  if (SENSITIVE_KEY.test(key)) return FILTERED;
  return scrubDeep(value, depth);
}

function scrubDeep(value: unknown, depth: number): unknown {
  if (!value || typeof value !== 'object') return value;
  if (depth >= MAX_SCRUB_DEPTH) return FILTERED;
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = scrubValue(key, item, depth + 1);
  }
  return out;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  return scrubDeep(obj, 0) as Record<string, unknown>;
}

function scrubQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      let name = key;
      try {
        name = decodeURIComponent(key);
      } catch {
        // Keep the raw key when it is not valid percent-encoding.
      }
      return SENSITIVE_KEY.test(name) ? `${key}=${FILTERED}` : pair;
    })
    .join('&');
}

/** Filter sensitive query parameters, keep the rest of the address. */
export function scrubUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return url;
  const base = beforeHash.slice(0, queryAt);
  return `${base}?${scrubQuery(beforeHash.slice(queryAt + 1))}${hash}`;
}

/** Remove private data from an event. Mutates and returns it. */
export function scrubEvent<T extends SentryEventLike>(event: T): T {
  const request = event.request;
  if (request) {
    // Ranch's bodies are chat messages, file contents and provider keys. A
    // key filter cannot recognise a chat message; not attaching bodies can.
    delete request.data;
    delete request.cookies;
    if (request.headers) request.headers = scrubObject(request.headers);
    if (typeof request.url === 'string') request.url = scrubUrl(request.url);
    if (typeof request.query_string === 'string') {
      request.query_string = scrubQuery(request.query_string);
    } else if (request.query_string !== undefined) {
      delete request.query_string;
    }
  }

  if (event.user) {
    const id = event.user.id;
    if (id === undefined || id === null) delete event.user;
    else event.user = { id };
  }

  if (event.extra) event.extra = scrubObject(event.extra);
  if (event.contexts) event.contexts = scrubObject(event.contexts);
  return event;
}

/** Drop console breadcrumbs, filter addresses in the rest. */
export function scrubBreadcrumb<T extends SentryBreadcrumbLike>(
  crumb: T,
): T | null {
  try {
    // Console breadcrumbs carry whatever the code logged, which in the API
    // includes agent traffic.
    if (crumb.category === 'console') return null;
    const data = crumb.data;
    if (data) {
      for (const key of ['url', 'from', 'to']) {
        const value = data[key];
        if (typeof value === 'string') data[key] = scrubUrl(value);
      }
    }
    return crumb;
  } catch {
    return null;
  }
}

/**
 * The single gate every event passes, however it was captured: decide,
 * label, rate-limit, scrub. Anything that throws inside drops the event —
 * never send one unscrubbed.
 */
export function createBeforeSend(
  project: SentryProject,
  now: () => number = Date.now,
): SentryInitOptions['beforeSend'] {
  let sent: number[] = [];

  return (event, hint) => {
    try {
      const decision = decide(hint?.originalException, project);
      if (!decision.report) return null;

      const at = now();
      sent = sent.filter((time) => at - time < RATE_WINDOW_MS);
      if (sent.length >= MAX_EVENTS_PER_MINUTE) return null;
      sent.push(at);

      event.tags = { ...event.tags, ...decision.tags };
      if (Object.keys(decision.extra).length > 0) {
        event.extra = { ...event.extra, ...decision.extra };
      }
      return scrubEvent(event);
    } catch {
      return null;
    }
  };
}

/** Everything `init` needs except the SDK itself. */
export function buildInitOptions(
  config: ReportingConfig,
  now: () => number = Date.now,
): SentryInitOptions {
  return {
    dsn: config.dsn,
    // Off, rather than relied on to be filtered afterwards.
    sendDefaultPii: false,
    // There is no other deployed environment; local dev never initialises.
    environment: 'production',
    release: config.release,
    initialScope: {
      tags: { project: config.project, installation: config.installation },
    },
    // Errors only: no tracesSampleRate, so tracing stays off.
    beforeSend: createBeforeSend(config.project, now),
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
