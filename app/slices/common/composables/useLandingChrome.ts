/**
 * Shared head setup for the pages that live in the landing's visual world
 * (the landing itself and the sign-in / sign-up gate): brand typography and
 * the dark body so overscroll never flashes the console's white.
 *
 * Geist for everything readable, Geist Mono for technical labels,
 * DotGothic16 for the few dot-matrix accents. The console keeps its own.
 */
export function useLandingChrome() {
  useHead({ bodyAttrs: { class: 'landing-body' } });
}

// The brand typefaces (Geist, Geist Mono, Unbounded, DotGothic16) are
// self-hosted @font-face rules in assets/css/fonts.css, loaded with the
// slice's CSS for every page. They used to come from Google Fonts through
// useHead; a <link> whose media attribute is toggled on load is re-applied
// by unhead on every head update, so a language switch silently turned the
// fonts off again (CLEAN-215).

/**
 * Entrance animations are one-shot: once played, the element is frozen in
 * its final state and the animation removed (see `.land-enter--done` in
 * landing.css for why this matters for fixed navigation).
 */
export function onLandingAnimationEnd(event: AnimationEvent) {
  const el = event.target as HTMLElement | null;
  if (el?.classList?.contains('land-enter')) el.classList.add('land-enter--done');
}
