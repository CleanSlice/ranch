import type { Ref } from 'vue';
import { springAtRest, stepSpring, type ISpringState } from '#profile/utils/spring';

/**
 * The pass on its lanyard as a thing with weight (CLEAN-217).
 *
 * On opening the page the pass drops out from behind the header, the lanyard
 * catches it, it swings around the top of the lanyard and comes to rest; the
 * card on its clip turns a little late. Once it is still, a fast pass of the
 * pointer nudges it and it settles again.
 *
 * How it is built:
 *  - `rig` (lanyard + clip + card) sits in its final place in the layout from
 *    the first frame; only its `transform` moves, so nothing else on the page
 *    shifts. It turns around the top of the lanyard.
 *  - `hanger` (clip + card) turns around the clip, relative to the rig.
 *  - Three damped springs (the catch, the swing, the card) are stepped in one
 *    requestAnimationFrame loop that stops itself at rest: exact zeros are
 *    written, the transforms and `will-change` are removed, and no frame is
 *    requested again. Nothing here runs forever.
 *  - It plays once per mount. Polling, a language switch or copying the id
 *    re-render the page without remounting the pass, so they do not replay it.
 *  - Under `prefers-reduced-motion: reduce` nothing is set up at all.
 *
 * The numbers start from the brief and are tuned by eye on the live page:
 * the pass should look heavy, with no rubbery shiver at the end.
 */
export function usePassSwing(els: {
  root: Ref<HTMLElement | null>;
  rig: Ref<HTMLElement | null>;
  hanger: Ref<HTMLElement | null>;
}) {
  /** Free fall from behind the header, constant acceleration. */
  const FALL_S = 0.42;
  /** The lanyard taking the weight: about 12 px past rest, then back. The
   *  pass arrives much faster than this; the rest of that speed is the
   *  lanyard going taut, which is not drawn. */
  const CATCH = { omega: 18, damping: 0.35 };
  const CATCH_VELOCITY = 340; // px/s
  /** The pendulum: -7° → about +4.5° → -2.8° → +1.7° → rest. */
  const SWING_START_DEG = -7;
  const SWING_OMEGA = (2 * Math.PI) / 0.95;
  const SWING_DAMPING = 0.14;
  /** After four swings the damping is raised so the tail dies instead of
   *  trembling for another two seconds (and the entry fits in 3.5 s). */
  const SWING_TAIL_FROM_S = 1.6;
  const SWING_TAIL_DAMPING = 0.9;
  /** The card chasing the lanyard's angle, never more than 2° behind. */
  const CARD = { omega: 10, damping: 0.5 };
  const CARD_MAX_DEG = 2;
  /** Hard limit for the whole entry, first frame to rest. */
  const ENTRY_S = 3.5;
  /** A pointer faster than this (px/ms) across the pass pushes it. */
  const PUSH_SPEED = 1.2;
  const PUSH_MAX_DEG = 3;

  type Phase = 'idle' | 'fall' | 'swing';
  let phase: Phase = 'idle';
  let frame = 0;
  let startedAt = 0; // entry start; 0 when this run is a pointer nudge
  let caughtAt = 0;
  let steppedAt = 0;
  let dropFrom = 0;
  let catchSpring: ISpringState = { value: 0, velocity: 0 };
  let swing: ISpringState = { value: 0, velocity: 0 };
  let cardAngle: ISpringState = { value: 0, velocity: 0 };
  let waitingForVisible = false;

  function draw(y: number) {
    const rig = els.rig.value;
    const hanger = els.hanger.value;
    if (!rig || !hanger) return;
    const lag = Math.max(
      -CARD_MAX_DEG,
      Math.min(CARD_MAX_DEG, cardAngle.value - swing.value),
    );
    rig.style.transform = `translateY(${y.toFixed(2)}px) rotate(${swing.value.toFixed(3)}deg)`;
    hanger.style.transform = `rotate(${lag.toFixed(3)}deg)`;
  }

  /** Exact zeros, no transform, no pending frame. */
  function rest() {
    cancelAnimationFrame(frame);
    frame = 0;
    phase = 'idle';
    startedAt = 0;
    catchSpring = { value: 0, velocity: 0 };
    swing = { value: 0, velocity: 0 };
    cardAngle = { value: 0, velocity: 0 };
    for (const el of [els.rig.value, els.hanger.value]) {
      if (!el) continue;
      el.style.transform = '';
      el.style.willChange = '';
    }
  }

  function step(now: number) {
    frame = 0;
    const dt = Math.max(0, (now - steppedAt) / 1000);
    steppedAt = now;
    let y = 0;

    if (phase === 'fall') {
      const t = (now - startedAt) / 1000;
      if (t < FALL_S) {
        // From rest under constant acceleration: what is left to fall goes
        // as 1 - (t/T)².
        y = dropFrom * (1 - (t / FALL_S) ** 2);
      } else {
        phase = 'swing';
        caughtAt = now;
        catchSpring = { value: 0, velocity: CATCH_VELOCITY };
      }
    }
    if (phase === 'swing') {
      const since = (now - caughtAt) / 1000;
      const tail = Math.min(1, Math.max(0, since - SWING_TAIL_FROM_S));
      const damping = SWING_DAMPING + (SWING_TAIL_DAMPING - SWING_DAMPING) * tail * tail;
      catchSpring = stepSpring(catchSpring, 0, dt, CATCH);
      swing = stepSpring(swing, 0, dt, { omega: SWING_OMEGA, damping });
      cardAngle = stepSpring(cardAngle, swing.value, dt, CARD);
      y = catchSpring.value;

      const still =
        springAtRest(swing, 0, 0.05, 0.5) &&
        springAtRest(catchSpring, 0, 0.2, 2) &&
        Math.abs(cardAngle.value - swing.value) < 0.05;
      const overtime = startedAt > 0 && now - startedAt >= ENTRY_S * 1000;
      if (still || overtime) {
        rest();
        return;
      }
    }
    draw(y);
    frame = requestAnimationFrame(step);
  }
  function run() {
    if (frame) return;
    steppedAt = performance.now();
    frame = requestAnimationFrame(step);
  }

  function drop() {
    const rig = els.rig.value;
    const hanger = els.hanger.value;
    if (!rig || !hanger) return;
    phase = 'fall';
    startedAt = performance.now();
    swing = { value: SWING_START_DEG, velocity: 0 };
    // The card starts in line with the lanyard and falls behind as it turns.
    cardAngle = { value: SWING_START_DEG, velocity: 0 };
    rig.style.willChange = 'transform';
    hanger.style.willChange = 'transform';
    draw(dropFrom);
    run();
  }

  function onVisible() {
    if (document.hidden || !waitingForVisible) return;
    waitingForVisible = false;
    document.removeEventListener('visibilitychange', onVisible);
    drop();
  }

  // Keyboard focus landing inside the pass while it still moves: stop at
  // once, so whatever is focused is not swinging under the reader.
  function onFocusIn() {
    if (phase !== 'idle' || waitingForVisible) {
      waitingForVisible = false;
      rest();
    }
  }

  let sweepX = 0;
  let sweepAt = 0;
  function onSweep(event: PointerEvent) {
    const now = performance.now();
    if (sweepAt && now > sweepAt) {
      const speed = (event.clientX - sweepX) / (now - sweepAt); // px per ms
      // Only a pass at rest is nudged, and only by a fast pointer: a slow
      // one reading the card must not rock it.
      if (phase === 'idle' && !waitingForVisible && Math.abs(speed) > PUSH_SPEED) {
        const amplitude = Math.min(PUSH_MAX_DEG, Math.abs(speed) * 1.5);
        // The pointer going right carries the bottom of the pass right,
        // which is a negative rotation around the top of the lanyard.
        swing = { value: 0, velocity: -Math.sign(speed) * amplitude * SWING_OMEGA };
        cardAngle = { value: 0, velocity: 0 };
        catchSpring = { value: 0, velocity: 0 };
        phase = 'swing';
        startedAt = 0;
        caughtAt = now;
        for (const el of [els.rig.value, els.hanger.value]) {
          if (el) el.style.willChange = 'transform';
        }
        run();
      }
    }
    sweepX = event.clientX;
    sweepAt = now;
  }

  onMounted(() => {
    const rig = els.rig.value;
    if (!rig) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    dropFrom = -(rig.offsetHeight + 40);
    els.root.value?.addEventListener('focusin', onFocusIn);
    if (document.hidden) {
      // Opened in a background tab: hold the pass above the header and let
      // it fall when someone is there to see it.
      waitingForVisible = true;
      swing = { value: SWING_START_DEG, velocity: 0 };
      cardAngle = { value: SWING_START_DEG, velocity: 0 };
      draw(dropFrom);
      document.addEventListener('visibilitychange', onVisible);
    } else {
      // Set before the first paint, so the pass is never seen at rest first.
      drop();
    }

    // The nudge needs a pointer that hovers.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      els.root.value?.addEventListener('pointermove', onSweep);
    }
  });
  onUnmounted(() => {
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', onVisible);
    els.root.value?.removeEventListener('focusin', onFocusIn);
    els.root.value?.removeEventListener('pointermove', onSweep);
  });
}
