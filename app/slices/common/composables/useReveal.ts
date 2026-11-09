/**
 * Scroll reveal for the landing page. Every `[data-reveal]` element under
 * `root` gets `is-in` once it enters the viewport; the CSS in landing.css
 * does the fade/rise. One observer for the whole page, each element is
 * unobserved after it shows, and reduced-motion users see everything at
 * once (the CSS already removes the transition; this skips the observer so
 * nothing ever starts hidden).
 */
export function useReveal(root: Ref<HTMLElement | null>) {
  let observer: IntersectionObserver | null = null;

  function showAll() {
    root.value
      ?.querySelectorAll<HTMLElement>('[data-reveal]')
      .forEach((el) => el.classList.add('is-in'));
  }

  onMounted(() => {
    if (!root.value) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      showAll();
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    root.value.querySelectorAll('[data-reveal]').forEach((el) => observer!.observe(el));
  });

  onBeforeUnmount(() => observer?.disconnect());
}
