import type { Ref } from 'vue';

/**
 * The clock behind the landing's scripted scenes (the chat that streams, the
 * log that scrolls, the lifecycle that advances).
 *
 * `t` counts ticks, one per `interval` ms, and only while the scene can be
 * seen: the section is on screen, the tab is visible and the visitor has not
 * asked for reduced motion. A scene derives everything it shows from `t`, so
 * a paused scene resumes exactly where it stopped and no scene keeps a timer
 * of its own.
 *
 * `still` is true under reduced motion. A scene then shows its finished
 * state (the whole reply, every step done) instead of a frozen first frame.
 */
export function useSceneClock(root: Ref<HTMLElement | null>, { interval = 90, threshold = 0.12 } = {}) {
  const t = ref(0);
  const still = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let observer: IntersectionObserver | null = null;
  let reduced: MediaQueryList | null = null;
  let visible = false;

  function sync() {
    const run = visible && !document.hidden && !still.value;
    if (run && !timer) {
      timer = setInterval(() => {
        t.value += 1;
      }, interval);
    } else if (!run && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  const onReduced = (e: MediaQueryListEvent) => {
    still.value = e.matches;
    sync();
  };

  onMounted(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    still.value = reduced.matches;
    reduced.addEventListener('change', onReduced);
    document.addEventListener('visibilitychange', sync);
    if (!root.value || typeof IntersectionObserver === 'undefined') {
      visible = true;
      sync();
      return;
    }
    observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        sync();
      },
      { threshold },
    );
    observer.observe(root.value);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    reduced?.removeEventListener('change', onReduced);
    document.removeEventListener('visibilitychange', sync);
    if (timer) clearInterval(timer);
    timer = null;
  });

  return { t, still };
}
