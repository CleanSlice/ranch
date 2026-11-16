/**
 * "Visitors are being asked to wait", as a pure reducer (CLEAN-224).
 *
 * The hub tells every chat on an agent when an hour or day request limit
 * fills (`agent_limit { limited: true, retryAfterMs, window }`) and when room
 * is made early (`{ limited: false }`). Operators are never limited, so in the
 * admin console the event only drives one informational line above the
 * composer — an operator testing an agent that is at its limit must not
 * conclude that it is fine for everybody.
 *
 * `until` is on the `performance.now()` scale, not the wall clock: the wait
 * arrives as a duration, and a duration added to a monotonic clock cannot go
 * wrong when the device's clock is wrong or is changed.
 *
 * The app console keeps the same shape under `limits` for its own notice
 * (`app/slices/bridle`); there it also disables Send. Here it does not.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
export type VisitorLimitWindow = 'minute' | 'hour' | 'day';

export interface IVisitorLimit {
  /** When the wait ends, on the `performance.now()` scale. */
  until: number;
  window: VisitorLimitWindow;
}

export type VisitorLimits = Record<string, IVisitorLimit>;

const WINDOWS: readonly string[] = ['minute', 'hour', 'day'];

function without(state: VisitorLimits, agentId: string): VisitorLimits {
  if (!(agentId in state)) return state;
  const next = { ...state };
  delete next[agentId];
  return next;
}

/**
 * Apply one `agent_limit` event. Anything malformed leaves the state as it
 * was — an event this console cannot read must not put up, or take down, a
 * line about visitors. `fallbackAgentId` is the agent of the socket the event
 * arrived on, for an event that does not name one.
 */
export function applyAgentLimit(
  state: VisitorLimits,
  event: unknown,
  now: number,
  fallbackAgentId?: string,
): VisitorLimits {
  if (!event || typeof event !== 'object') return state;
  const e = event as Record<string, unknown>;
  const agentId =
    typeof e.agentId === 'string' && e.agentId ? e.agentId : fallbackAgentId;
  if (!agentId) return state;

  if (e.limited === false) return without(state, agentId);
  if (e.limited !== true) return state;

  const retryAfterMs = e.retryAfterMs;
  if (typeof retryAfterMs !== 'number' || !Number.isFinite(retryAfterMs)) {
    return state;
  }
  // A wait that is already over is the same news as "room was made".
  if (retryAfterMs <= 0) return without(state, agentId);
  const window = (
    typeof e.window === 'string' && WINDOWS.includes(e.window) ? e.window : 'hour'
  ) as VisitorLimitWindow;
  return { ...state, [agentId]: { until: now + retryAfterMs, window } };
}

/** Drop every entry whose wait has passed. Returns the same object when none has. */
export function pruneVisitorLimits(
  state: VisitorLimits,
  now: number,
): VisitorLimits {
  let next: VisitorLimits | null = null;
  const ids = Object.keys(state);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!;
    if (state[id]!.until > now) continue;
    if (!next) next = { ...state };
    delete next[id];
  }
  return next ?? state;
}

/** Forget one agent — its chat reconnected and the hub will say again if it is still full. */
export function clearVisitorLimit(
  state: VisitorLimits,
  agentId: string,
): VisitorLimits {
  return without(state, agentId);
}
