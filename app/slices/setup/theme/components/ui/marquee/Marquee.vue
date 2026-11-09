<script lang="ts" setup>
import { cn } from '#theme/utils';

/**
 * A row that scrolls its children sideways forever. Adapted from Inspira
 * UI's marquee: the theme's `cn`, and the keyframes live here instead of a
 * Tailwind `animate-marquee` utility so the component works from any
 * stylesheet. Speed comes from --land-fx-marquee-duration; `pauseOnHover`
 * holds it under the pointer; useFxPause holds it off screen; `land-fx`
 * lets the reduced-motion rule stop it.
 */
withDefaults(
  defineProps<{
    class?: string;
    reverse?: boolean;
    pauseOnHover?: boolean;
    /** How many times the slot content is repeated so the loop has no gap. */
    repeat?: number;
  }>(),
  {
    pauseOnHover: false,
    repeat: 4,
  },
);
</script>

<template>
  <div :class="cn('marquee land-fx group flex overflow-hidden p-2', pauseOnHover && 'marquee--pause-on-hover', $props.class)">
    <div
      v-for="index in repeat"
      :key="index"
      class="marquee__track flex shrink-0 justify-around"
      :style="{ animationDirection: reverse ? 'reverse' : 'normal' }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.marquee {
  --gap: 1rem;
  --duration: var(--land-fx-marquee-duration, 40s);
  gap: var(--gap);
}

.marquee__track {
  gap: var(--gap);
  animation: land-marquee var(--duration) linear infinite;
}

.marquee--pause-on-hover:hover .marquee__track {
  animation-play-state: paused;
}

@keyframes land-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-100% - var(--gap)));
  }
}
</style>
