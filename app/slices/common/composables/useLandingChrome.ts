/**
 * Shared head setup for the pages that live in the landing's visual world
 * (the landing itself and the sign-in / sign-up gate): brand typography and
 * the dark body so overscroll never flashes the console's white.
 *
 * Geist for everything readable, Geist Mono for technical labels,
 * DotGothic16 for the few dot-matrix accents. The console keeps its own.
 */
export function useLandingChrome() {
  useBrandFonts();
  useHead({ bodyAttrs: { class: 'landing-body' } });
}

/** The brand typefaces alone — the console loads these over its own theme. */
export function useBrandFonts() {
  const href =
    'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=DotGothic16&display=swap';
  useHead({
    link: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
      // Loaded as a print stylesheet and promoted once it arrives, so the
      // font CSS never blocks the first paint; the faces still swap in
      // (display=swap). Measured in CLEAN-215: the blocking stylesheet was
      // part of a 0.3 s LCP regression on the landing.
      { rel: 'stylesheet', href, media: 'print', onload: "this.media='all'" },
    ],
    noscript: [{ innerHTML: `<link rel="stylesheet" href="${href}">` }],
  });
}

/**
 * Entrance animations are one-shot: once played, the element is frozen in
 * its final state and the animation removed (see `.land-enter--done` in
 * landing.css for why this matters for fixed navigation).
 */
export function onLandingAnimationEnd(event: AnimationEvent) {
  const el = event.target as HTMLElement | null;
  if (el?.classList?.contains('land-enter')) el.classList.add('land-enter--done');
}
