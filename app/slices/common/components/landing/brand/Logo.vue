<script setup lang="ts">
/**
 * The RANCH brand mark, reconstructed in SVG from the approved identity:
 * a lavender-to-copper arch, three neural nodes, and a speech bubble whose
 * leg forms the R. One component, four uses:
 *
 *  - `full`     mark + wordmark, gradient arch (hero, final CTA)
 *  - `mark`     mark only (floating nav button, favicon-size)
 *  - `wordmark` the RANCH lettering alone
 *  - `symbol`   the bubble with one active node (avatars, status markers)
 *
 * `mono` paints everything in currentColor for light surfaces and print.
 *
 * With the `orbit` brand variant (see useBrandVariant) the raster lockup is
 * shown instead: the copper R-bubble mark and the RANCH wordmark, cut from
 * the approved artwork with the background removed. A raster cannot be
 * recolored, so `symbol` keeps the shared bubble glyph in SVG — both
 * identities use the same three-dot speech bubble with the R leg.
 */
const props = withDefaults(
  defineProps<{
    variant?: 'full' | 'mark' | 'wordmark' | 'symbol';
    mono?: boolean;
    /** Height of the mark in px; the wordmark scales with it. */
    size?: number;
    /** Omit when the logo sits inside a link that already has a name. */
    label?: string | null;
  }>(),
  { variant: 'full', mono: false, size: 32, label: 'RANCH' },
);

// Gradient ids must be unique per instance or every mark on the page paints
// with the first one's gradient.
const uid = useId();
const archId = computed(() => `ranch-arch-${uid}`);
const stemId = computed(() => `ranch-stem-${uid}`);

const archStroke = computed(() =>
  props.mono ? 'currentColor' : `url(#${archId.value})`,
);
const stemStroke = computed(() =>
  props.mono ? 'currentColor' : `url(#${stemId.value})`,
);
const ink = computed(() => (props.mono ? 'currentColor' : '#FFFFFF'));
const wordHeight = computed(() => Math.round(props.size * 0.34));
const wordWidth = computed(() => Math.round(wordHeight.value * (332 / 72)));

const { variant: brand } = useBrandVariant();
// The raster takes over every brand-bearing use (it is transparent, so it
// sits on the footer and panels too); only the tiny `symbol` glyph stays SVG.
const orbit = computed(() => brand.value === 'orbit' && props.variant !== 'symbol');
// The transparent lockup split in two, in px: mark 562×489, wordmark 1505×241.
const orbitMarkW = computed(() => Math.round(props.size * (562 / 489)));
const orbitWordH = computed(() => Math.round(props.size * 0.4));
const orbitWordW = computed(() => Math.round(orbitWordH.value * (1505 / 241)));
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center"
    :style="{ gap: `${Math.round(size * 0.38)}px` }"
    :role="label ? 'img' : undefined"
    :aria-label="label ?? undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <!-- Orbit identity: the supplied raster, reused as delivered -->
    <template v-if="orbit">
      <img
        v-if="variant === 'full' || variant === 'mark'"
        class="land-logo__orbit-mark"
        src="/landing/brand/orbit-mark.webp"
        :width="orbitMarkW"
        :height="size"
        alt=""
        decoding="async"
      />
      <img
        v-if="variant === 'full' || variant === 'wordmark'"
        src="/landing/brand/orbit-wordmark.webp"
        :width="variant === 'wordmark' ? Math.round(size * (1505 / 241)) : orbitWordW"
        :height="variant === 'wordmark' ? size : orbitWordH"
        alt=""
        decoding="async"
      />
    </template>

    <svg
      v-else-if="variant === 'full' || variant === 'mark'"
      :width="size"
      :height="size"
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs v-if="!mono">
        <linearGradient :id="archId" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#C9A1E4" />
          <stop offset="0.5" stop-color="#FBE9E3" />
          <stop offset="1" stop-color="#F5A16B" />
        </linearGradient>
        <linearGradient :id="stemId" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#9C6D9C" />
          <stop offset="1" stop-color="#F3C9D8" />
        </linearGradient>
      </defs>
      <path
        d="M13 100 V48 A37 37 0 0 1 87 48 V100"
        fill="none"
        :stroke="archStroke"
        :stroke-width="size < 40 ? 8.5 : 7"
      />
      <g
        fill="none"
        :stroke="stemStroke"
        :stroke-width="size < 40 ? 3.8 : 3.2"
        stroke-linecap="round"
      >
        <path d="M50 50 V30" />
        <path d="M48 50 C47 42 42 38 35 36" />
        <path d="M52 50 C53 42 58 38 65 36" />
      </g>
      <circle cx="50" cy="25" :r="size < 40 ? 5.6 : 5" :fill="mono ? 'currentColor' : '#FBEFF5'" />
      <circle cx="31" cy="34" :r="size < 40 ? 5 : 4.5" :fill="mono ? 'currentColor' : '#D9B4EA'" />
      <circle cx="69" cy="34" :r="size < 40 ? 5 : 4.5" :fill="mono ? 'currentColor' : '#F7B98F'" />
      <path
        d="M77 97 L57 78 L34 78 L23 89 V58 Q23 50 31 50 H69 Q77 50 77 58 V70 Q77 78 69 78 H57"
        fill="none"
        :stroke="ink"
        :stroke-width="size < 40 ? 7.2 : 6.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g :fill="ink">
        <circle cx="40" cy="64" :r="size < 40 ? 3.5 : 3" />
        <circle cx="50" cy="64" :r="size < 40 ? 3.5 : 3" />
        <circle cx="60" cy="64" :r="size < 40 ? 3.5 : 3" />
      </g>
    </svg>

    <svg
      v-else-if="variant === 'symbol'"
      :width="size"
      :height="size"
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M77 97 L57 78 L34 78 L23 89 V58 Q23 50 31 50 H69 Q77 50 77 58 V70 Q77 78 69 78 H57"
        fill="none"
        :stroke="ink"
        :stroke-width="size < 28 ? 11 : 8"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g v-if="size >= 28" :fill="ink">
        <circle cx="40" cy="64" r="3.8" />
        <circle cx="50" cy="64" r="3.8" />
        <circle cx="60" cy="64" r="3.8" />
      </g>
      <path
        v-if="size >= 28"
        d="M50 50 V33"
        fill="none"
        :stroke="mono ? 'currentColor' : '#C9A1E4'"
        stroke-width="4"
        stroke-linecap="round"
      />
      <circle cx="50" cy="28" :r="size < 28 ? 10 : 7" :fill="mono ? 'currentColor' : '#F5A16B'" />
    </svg>

    <svg
      v-if="!orbit && (variant === 'full' || variant === 'wordmark')"
      :width="variant === 'wordmark' ? Math.round(size * (332 / 72)) : wordWidth"
      :height="variant === 'wordmark' ? size : wordHeight"
      viewBox="-6 -6 332 72"
      fill="none"
      :stroke="ink"
      stroke-width="9"
      stroke-linejoin="round"
      stroke-linecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 60 V4.5 H30 a13 13 0 0 1 0 26 H4.5" />
      <path d="M24 30.5 L44 60" />
      <path d="M68 60 L95 4.5 L122 60" stroke-linejoin="miter" />
      <path d="M142 60 V4.5 L188 60 V4.5" />
      <path d="M256 12 A28 28 0 1 0 256 52" />
      <path d="M278 4.5 V60 M324 4.5 V60 M278 32 H324" />
    </svg>
  </span>
</template>

<style scoped>
.land-logo__orbit-mark {
  object-fit: contain;
}
</style>
