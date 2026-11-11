// A damped spring, stepped by hand (CLEAN-217). Pure on purpose: no Vue, no
// Nuxt aliases, no clock of its own, so `bun test` runs it and the caller
// decides what a frame is.

export interface ISpringState {
  value: number;
  /** Units of `value` per second. */
  velocity: number;
}

export interface ISpringParams {
  /** Natural angular frequency, rad/s: 2π / period. */
  omega: number;
  /** Damping ratio: 0 never stops, 1 does not overshoot. */
  damping: number;
}

/** Longest stretch of time one call will simulate. A tab that was in the
 *  background for a minute comes back with one huge frame; replaying all of
 *  it would be wasted work, and the spring has long since stopped anyway. */
export const MAX_SPRING_DT = 0.25;
/** Slice the step so the integration stays stable at any frame rate. */
const SLICE = 0.004;

/**
 * Advances the spring by `dt` seconds towards `target` and returns the new
 * state (the one passed in is not touched).
 *
 * x'' = -ω²(x - target) - 2ζω·x', integrated with semi-implicit Euler in
 * slices of at most 4 ms: stable for the frequencies used here whatever the
 * frame took, and energy only ever leaves the system, so a long frame cannot
 * blow the value up.
 */
export function stepSpring(
  state: ISpringState,
  target: number,
  dt: number,
  params: ISpringParams,
): ISpringState {
  const total = Math.min(MAX_SPRING_DT, Math.max(0, dt));
  if (total === 0) return { value: state.value, velocity: state.velocity };
  const steps = Math.ceil(total / SLICE);
  const h = total / steps;
  let value = state.value;
  let velocity = state.velocity;
  for (let i = 0; i < steps; i++) {
    const acc =
      -params.omega * params.omega * (value - target) -
      2 * params.damping * params.omega * velocity;
    velocity += acc * h;
    value += velocity * h;
  }
  return { value, velocity };
}

/** True once the spring is close enough to `target` to be called still. */
export function springAtRest(
  state: ISpringState,
  target: number,
  valueEps: number,
  velocityEps: number,
): boolean {
  return (
    Math.abs(state.value - target) < valueEps && Math.abs(state.velocity) < velocityEps
  );
}
