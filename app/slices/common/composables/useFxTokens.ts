/**
 * The landing's effect settings, read from the `--land-fx-*` tokens in
 * landing.css so colour, speed and size can be tuned there without touching
 * a component. Colours stay CSS (`var(--land-fx-from)` is passed through as a
 * string); only the values a component needs as a number are read here, once,
 * after mount. Before mount the defaults below match the stylesheet.
 *
 * `reducedMotion` and `noHover` follow their media queries live, so a user
 * who flips the OS setting while the page is open gets the static version
 * without a reload.
 */
export interface FxTokens {
  spotSize: number;
  beamSeconds: number;
  borderBeamSeconds: number;
  meteorCount: number;
  reducedMotion: boolean;
  noHover: boolean;
}

const DEFAULTS: FxTokens = {
  spotSize: 320,
  beamSeconds: 6,
  borderBeamSeconds: 10,
  meteorCount: 6,
  reducedMotion: false,
  noHover: false,
};

export function useFxTokens() {
  const fx = reactive<FxTokens>({ ...DEFAULTS });
  let reduced: MediaQueryList | null = null;
  let hover: MediaQueryList | null = null;
  const onReduced = (e: MediaQueryListEvent) => (fx.reducedMotion = e.matches);
  const onHover = (e: MediaQueryListEvent) => (fx.noHover = e.matches);

  onMounted(() => {
    const root = document.querySelector('.landing') ?? document.documentElement;
    const css = getComputedStyle(root);
    const num = (name: string, fallback: number) => {
      const value = Number.parseFloat(css.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    fx.spotSize = num('--land-fx-spot-size', DEFAULTS.spotSize);
    fx.beamSeconds = num('--land-fx-beam-duration', DEFAULTS.beamSeconds);
    fx.borderBeamSeconds = num('--land-fx-border-beam-duration', DEFAULTS.borderBeamSeconds);
    fx.meteorCount = Math.round(num('--land-fx-meteor-count', DEFAULTS.meteorCount));

    reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    hover = window.matchMedia('(hover: none)');
    fx.reducedMotion = reduced.matches;
    fx.noHover = hover.matches;
    reduced.addEventListener('change', onReduced);
    hover.addEventListener('change', onHover);
  });

  onBeforeUnmount(() => {
    reduced?.removeEventListener('change', onReduced);
    hover?.removeEventListener('change', onHover);
  });

  return fx;
}
