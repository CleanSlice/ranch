import { usePreferredReducedMotion, useTransition } from '@vueuse/core';

/**
 * How long a scoreboard figure takes to reach its value, and the curve it
 * follows (fast, then settling): both from the prototype's `countUp()`
 * (specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html).
 */
const COUNT_MS = 700;
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

/**
 * A whole number that counts up to its value once when the block appears, and
 * from the old value to the new one when the period changes (CLEAN-258).
 *
 * It is decoration: the value itself is `target()`, and anything that has to
 * be exact (a plural, a label read aloud, a browser check) reads that, not
 * this. Under `prefers-reduced-motion: reduce` the number is simply there.
 */
export function useCountUp(target: () => number) {
  const motion = usePreferredReducedMotion();
  // Starts at zero and gets the value on mount, so the first paint counts up
  // instead of standing still at the answer.
  const source = ref(0);
  const shown = useTransition(source, {
    duration: COUNT_MS,
    easing: easeOutCubic,
    disabled: computed(() => motion.value === 'reduce'),
  });
  onMounted(() => {
    source.value = target();
  });
  watch(target, (value) => {
    source.value = value;
  });
  return computed(() => Math.round(shown.value));
}
