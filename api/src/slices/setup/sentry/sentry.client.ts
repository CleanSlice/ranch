import { readReportingConfig } from './sentry.config';
import { buildInitOptions, isReportingEnabled } from './sentry.rules';

type Sdk = typeof import('@sentry/bun');
type SdkOptions = NonNullable<Parameters<Sdk['init']>[0]>;
/** The two scope methods used here; `withScope` is overloaded in the SDK. */
interface SdkScope {
  setTag(key: string, value: string): unknown;
  setUser(user: { id: string } | null): unknown;
}

/**
 * The SDK's default integrations this API keeps. Errors only, so nothing
 * that patches `http`/`fetch`, tracks sessions (GlitchTip has none) or
 * attaches the request. `OnUncaughtException` and `OnUnhandledRejection` are
 * left out on purpose: the first exits the process, and `main.ts` keeps it
 * alive deliberately — those two failures are reported from its own handlers.
 */
const KEPT_INTEGRATIONS = new Set([
  'InboundFilters',
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'ContextLines',
  'Context',
]);

let sdk: Sdk | null = null;

/**
 * Start reporting, when this process runs from a built image and has a
 * destination. Anywhere else — local dev, jest, a build that set no DSN —
 * the SDK is not even loaded. Returns whether reporting is on. Never throws.
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (sdk) return true;
  try {
    const config = readReportingConfig(env);
    if (!isReportingEnabled(config)) return false;

    // Loaded here, not imported at the top: the runtime is Bun, the tests
    // run on Node, and neither they nor local dev should load the SDK.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@sentry/bun') as Sdk;
    const options = {
      ...buildInitOptions(config),
      integrations: (defaults: { name: string }[]) =>
        defaults.filter((integration) =>
          KEPT_INTEGRATIONS.has(integration.name),
        ),
    };
    loaded.init(options as unknown as SdkOptions);
    sdk = loaded;
    return true;
  } catch (err) {
    console.error(
      '[sentry] init failed, reporting is off:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** Fire and forget: never awaited, never throws, a no-op before init. */
function capture(err: unknown, label: (scope: SdkScope) => void): void {
  const active = sdk;
  if (!active) return;
  try {
    active.withScope((scope) => {
      label(scope);
      active.captureException(err);
    });
  } catch {
    // Reporting must not replace or mask the error being reported.
  }
}

export interface RequestErrorContext {
  /** `METHOD /route/:pattern` — the pattern, never the raw URL. */
  operation: string;
  userId?: string;
  agentId?: string;
}

/** A failure while answering a request. Called by the exception filter. */
export function captureRequestError(
  err: unknown,
  context: RequestErrorContext,
): void {
  capture(err, (scope) => {
    scope.setTag('origin', 'request');
    scope.setTag('operation', context.operation);
    if (context.agentId) scope.setTag('agentId', context.agentId);
    // The opaque id and nothing else about the person.
    if (context.userId) scope.setUser({ id: context.userId });
  });
}

/**
 * A failure in work nobody is waiting on: a timer, a watcher, a transport, a
 * queue consumer. Call it beside the `logger.error` in a catch that logs and
 * carries on; `area` names the work, e.g. `chat.insight`.
 */
export function captureBackgroundError(err: unknown, area: string): void {
  capture(err, (scope) => {
    scope.setTag('origin', 'background');
    scope.setTag('area', area);
  });
}

/** A failure that reached the process handlers in `main.ts`. */
export function captureProcessError(
  err: unknown,
  kind: 'unhandledRejection' | 'uncaughtException',
): void {
  captureBackgroundError(err, `process.${kind}`);
}
