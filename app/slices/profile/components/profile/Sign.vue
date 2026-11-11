<script setup lang="ts">
/**
 * The personal sign: initials inside a copper-to-lavender ring with a dashed
 * orbit and a copper arc underneath (CLEAN-217). It stands where a portrait
 * would, because the console holds no portrait.
 *
 * A component of its own, sized by one prop, so the same sign serves the pass
 * (176 px), the header pill (24 px) and, later, lists.
 */
const props = withDefaults(
  defineProps<{
    initials: string;
    size?: number;
    /** Accessible name. Without it the sign is decoration next to a name. */
    label?: string;
  }>(),
  { size: 176 },
);

// Gradient ids must be unique per instance: two signs on one page (header
// pill + pass) would otherwise share, and a hidden one would blank the other.
const uid = useId();
const strokeId = `profile-sign-stroke-${uid}`;
const fillId = `profile-sign-fill-${uid}`;

// Two letters fit the ring at 56; one letter can afford to be larger.
const fontSize = computed(() => (props.initials.length > 1 ? 56 : 68));
</script>

<template>
  <svg
    viewBox="0 0 200 200"
    :width="size"
    :height="size"
    class="block shrink-0"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <defs>
      <linearGradient :id="strokeId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f5a16b" />
        <stop offset="1" stop-color="#c9a1e4" />
      </linearGradient>
      <radialGradient :id="fillId" cx="0.5" cy="0.4" r="0.6">
        <stop offset="0" stop-color="#c9a1e4" stop-opacity="0.16" />
        <stop offset="1" stop-color="#c9a1e4" stop-opacity="0.02" />
      </radialGradient>
    </defs>
    <circle
      cx="100"
      cy="100"
      r="76"
      :fill="`url(#${fillId})`"
      :stroke="`url(#${strokeId})`"
      :stroke-width="size < 48 ? 8 : 2"
    />
    <ellipse
      cx="100"
      cy="100"
      rx="96"
      ry="30"
      transform="rotate(-24 100 100)"
      fill="none"
      stroke="#c9a1e4"
      stroke-opacity="0.6"
      stroke-width="1.2"
      stroke-dasharray="2 5"
    />
    <circle cx="187.7" cy="61" r="5.5" fill="#f5a16b" />
    <text
      x="101"
      y="113"
      text-anchor="middle"
      font-family="Geist, Inter, sans-serif"
      font-weight="600"
      :font-size="size < 48 ? 84 : fontSize"
      :dy="size < 48 ? 16 : 0"
      letter-spacing="2"
      fill="#f5f1f6"
    >
      {{ initials }}
    </text>
    <!-- At header size the arc is a smudge; the pass keeps it. -->
    <path
      v-if="size >= 48"
      d="M56 132 Q100 156 144 132"
      fill="none"
      stroke="#f5a16b"
      stroke-width="4"
      stroke-linecap="round"
    />
  </svg>
</template>
