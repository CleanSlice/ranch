import {
  buildInitOptions,
  isReportingEnabled,
  type ReportingConfig,
} from './sentry.rules';

type Sdk = typeof import('@sentry/vue');
type SdkOptions = NonNullable<Parameters<Sdk['init']>[0]>;

/** What the SDK loader resolves to. Injectable, so a test needs no browser. */
export type SdkLoader = () => Promise<Sdk>;

/**
 * Errors caught while the SDK is still loading are kept and sent once it is
 * ready: a failure during boot is the one most worth seeing. Bounded, so a
 * loop cannot grow it.
 */
const MAX_PENDING = 10;

let sdk: Sdk | null = null;
let starting = false;
let pending: unknown[] = [];
let userId: string | null = null;
let screen: string | null = null;

function applyContext(active: Sdk): void {
  // The opaque id and nothing else about the person.
  active.setUser(userId ? { id: userId } : null);
  if (screen) active.setTag('screen', screen);
}

/**
 * Start reporting, when this is a production build with a destination.
 * Anywhere else — `nuxt dev`, a build that set no DSN — the SDK is not even
 * downloaded. Resolves to whether reporting is on. Never throws.
 */
export async function initSentry(
  config: ReportingConfig,
  load: SdkLoader = () => import('@sentry/vue'),
): Promise<boolean> {
  if (sdk) return true;
  if (starting || !isReportingEnabled(config)) return false;
  starting = true;
  try {
    const loaded = await load();
    const options = {
      ...buildInitOptions(config),
      // No `app`: the existing Vue error handler in `setup/error` stays the
      // only one, and `handleError` reports. Sessions are dropped because
      // GlitchTip has none.
      integrations: (defaults: { name: string }[]) =>
        defaults.filter((integration) => integration.name !== 'BrowserSession'),
    };
    loaded.init(options as unknown as SdkOptions);
    sdk = loaded;
    applyContext(loaded);
    for (const err of pending) loaded.captureException(err);
    return true;
  } catch {
    // Reporting that cannot start is off; the console is unaffected.
    return false;
  } finally {
    pending = [];
    starting = false;
  }
}

/**
 * Hand an error to the tracker. The rules in `sentry.rules.ts` decide, in
 * `beforeSend`, whether it is sent. Never awaited, never throws, and a no-op
 * when reporting is off.
 */
export function captureSentryException(err: unknown): void {
  try {
    if (sdk) sdk.captureException(err);
    else if (starting && pending.length < MAX_PENDING) pending.push(err);
  } catch {
    // Reporting must not replace or mask the error being reported.
  }
}

/** The signed-in user's id, or `null` on sign-out. */
export function setSentryUser(id: string | null): void {
  userId = id;
  try {
    if (sdk) applyContext(sdk);
  } catch {
    // See captureSentryException.
  }
}

/** The matched route pattern (`/agents/:id`), never the resolved path. */
export function setSentryScreen(pattern: string): void {
  screen = pattern;
  try {
    if (sdk) applyContext(sdk);
  } catch {
    // See captureSentryException.
  }
}
