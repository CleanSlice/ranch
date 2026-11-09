/**
 * Which RANCH logo the landing shows. Two approved identities exist:
 *
 *  - `agent-hub`  the arch + neural nodes mark, reconstructed as SVG
 *  - `orbit`      the copper R-bubble with orbital rings, used as the
 *                 supplied raster (cropped only, never redrawn)
 *
 * The install picks one with `NUXT_PUBLIC_BRAND_VARIANT` (`orbit` unless
 * set); `?brand=agent-hub` or `?brand=orbit` on any landing URL overrides it
 * for that browser (kept in a cookie), so both can be compared on the same
 * deployment without a rebuild.
 */
export type BrandVariant = 'agent-hub' | 'orbit';

const VARIANTS: BrandVariant[] = ['agent-hub', 'orbit'];

function asVariant(value: unknown): BrandVariant | null {
  return typeof value === 'string' && (VARIANTS as string[]).includes(value)
    ? (value as BrandVariant)
    : null;
}

export function useBrandVariant() {
  const route = useRoute();
  const config = useRuntimeConfig();
  const cookie = useCookie<BrandVariant | null>('ranch-brand', {
    default: () => null,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });

  const fromQuery = asVariant(route.query.brand);
  if (fromQuery) cookie.value = fromQuery;

  const variant = computed<BrandVariant>(
    () =>
      asVariant(route.query.brand) ??
      cookie.value ??
      asVariant(config.public.brandVariant) ??
      'orbit',
  );

  function set(next: BrandVariant) {
    cookie.value = next;
  }

  return { variant, set, variants: VARIANTS };
}
