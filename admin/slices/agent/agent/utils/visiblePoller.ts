/**
 * A poll that only runs while someone can see the page (CLEAN-224, FR-046).
 *
 * `start()` runs once at once and then every `intervalMs`; a hidden tab stops
 * the timer, and coming back runs once at once and starts it again — so the
 * figures are fresh the moment the tab is looked at, and nothing is asked for
 * while nobody is looking. `stop()` ends it for good.
 *
 * A run that is still in flight is not started a second time: a slow API must
 * not pile requests up behind each other. A failed run is swallowed — a poll
 * keeps the last figures on screen and tries again on the next tick.
 *
 * No Vue / Nuxt imports and the browser is passed in, so this runs under
 * `bun test` with a hand-made clock.
 */
export interface IPollerEnv {
  isHidden(): boolean;
  /** Returns the function that removes the listener. */
  onVisibilityChange(listener: () => void): () => void;
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface IVisiblePoller {
  start(): void;
  stop(): void;
}

/** The real browser; inert on the server, where there is no document. */
export const browserPollerEnv: IPollerEnv = {
  isHidden: () =>
    typeof document === 'undefined' || document.visibilityState === 'hidden',
  onVisibilityChange(listener) {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
  setInterval: (run, ms) => setInterval(run, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createVisiblePoller(
  run: () => Promise<unknown>,
  intervalMs: number,
  env: IPollerEnv = browserPollerEnv,
): IVisiblePoller {
  let started = false;
  let timer: unknown = null;
  let inFlight = false;
  let removeListener: (() => void) | null = null;

  function tick() {
    if (inFlight) return;
    inFlight = true;
    run()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  }

  function pause() {
    if (timer === null) return;
    env.clearInterval(timer);
    timer = null;
  }

  function resume() {
    if (timer !== null) return;
    tick();
    timer = env.setInterval(tick, intervalMs);
  }

  function onVisibility() {
    if (!started) return;
    if (env.isHidden()) pause();
    else resume();
  }

  return {
    start() {
      if (started) return;
      started = true;
      removeListener = env.onVisibilityChange(onVisibility);
      if (!env.isHidden()) resume();
    },
    stop() {
      if (!started) return;
      started = false;
      pause();
      removeListener?.();
      removeListener = null;
    },
  };
}
