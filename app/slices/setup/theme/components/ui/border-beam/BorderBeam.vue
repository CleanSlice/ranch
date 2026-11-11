<script setup lang="ts">
import { cn } from '#theme/utils';

/**
 * One light travelling around the border of its parent (which must be
 * `position: relative` and carry the radius). Adapted from Inspira UI's
 * border-beam with the theme's `cn`; colours and duration come from the
 * landing tokens at the call site. Paused through `animation-play-state`
 * by useFxPause; the `land-fx` class lets the reduced-motion rule stop it.
 */
interface BorderBeamProps {
  class?: string;
  size?: number;
  /** Seconds for one lap. */
  duration?: number;
  borderWidth?: number;
  anchor?: number;
  colorFrom?: string;
  colorTo?: string;
  delay?: number;
}

const props = withDefaults(defineProps<BorderBeamProps>(), {
  size: 200,
  duration: 10,
  anchor: 90,
  borderWidth: 1.5,
  colorFrom: 'var(--land-fx-from, #d77b61)',
  colorTo: 'var(--land-fx-to, #c9a1e4)',
  delay: 0,
});

const durationInSeconds = computed(() => `${props.duration}s`);
const delayInSeconds = computed(() => `${props.delay}s`);
</script>

<template>
  <div
    :class="
      cn(
        `border-beam land-fx animate-border-beam pointer-events-none absolute inset-0 rounded-[inherit] mask-intersect! [mask-clip:padding-box,border-box]! [border:calc(var(--border-width)*1px)_solid_transparent] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)] after:absolute after:aspect-square after:w-[calc(var(--size)*1px)] after:[animation-delay:var(--delay)] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:calc(var(--anchor)*1%)_50%] after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)*1px))]`,
        props.class,
      )
    "
    aria-hidden="true"
  />
</template>

<style scoped>
.border-beam {
  --size: v-bind(size);
  --duration: v-bind(durationInSeconds);
  --anchor: v-bind(anchor);
  --border-width: v-bind(borderWidth);
  --color-from: v-bind(colorFrom);
  --color-to: v-bind(colorTo);
  --delay: v-bind(delayInSeconds);
}

.animate-border-beam::after {
  animation: border-beam-anim var(--duration) infinite linear;
}

@keyframes border-beam-anim {
  to {
    offset-distance: 100%;
  }
}
</style>
