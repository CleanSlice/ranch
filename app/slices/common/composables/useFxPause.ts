import type { Ref } from 'vue';

/**
 * Pauses every looping effect under `root` while the section is off screen
 * or the tab is hidden, and lets it run again when it comes back.
 *
 * CSS loops (border beam, marquee, meteors, shimmer) are paused through the
 * `data-fx-paused` attribute and the `animation-play-state` rule in
 * landing.css, so they resume where they stopped instead of restarting.
 * SMIL beams (AnimatedBeam's <animate>) have no CSS play state, so every
 * <svg> under the root is paused and unpaused by method.
 *
 * One observer per section root: five on the landing, not one per effect.
 * The 5 % threshold is "a sliver is visible": a beam that starts while the
 * section is still mostly below the fold is what pulls the eye down.
 */
export function useFxPause(root: Ref<HTMLElement | null>, { threshold = 0.05 } = {}) {
  let observer: IntersectionObserver | null = null;
  let visible = true;

  function apply() {
    const el = root.value;
    if (!el) return;
    const paused = !visible || document.hidden;
    el.toggleAttribute('data-fx-paused', paused);
    el.querySelectorAll('svg').forEach((svg) => {
      try {
        if (paused) svg.pauseAnimations();
        else svg.unpauseAnimations();
      } catch {
        // An SVG without SMIL content has nothing to pause.
      }
    });
  }

  function onVisibility() {
    apply();
  }

  onMounted(() => {
    if (!root.value || typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        apply();
      },
      { threshold },
    );
    observer.observe(root.value);
    document.addEventListener('visibilitychange', onVisibility);
    apply();
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('visibilitychange', onVisibility);
  });
}
