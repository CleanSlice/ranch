<script lang="ts" setup>
import { cn } from '#theme/utils';

/**
 * A few streaks of light falling across the parent (which must clip
 * overflow). Adapted from Inspira UI's meteors: the theme's `cn`, the colour
 * from the landing tokens instead of slate, and positions drawn once with a
 * fixed seed so a re-render never reshuffles them. Transform and opacity
 * only. Paused through `animation-play-state`; the caller does not render
 * it at all under reduced motion.
 */
const props = withDefaults(
  defineProps<{
    count?: number;
    color?: string;
    class?: string;
  }>(),
  {
    count: 6,
    color: 'var(--land-fx-from, #d77b61)',
  },
);

/** Deterministic 0..1 per meteor, so the same page always looks the same. */
function seeded(index: number, salt: number) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const meteors = computed(() =>
  Array.from({ length: Math.max(0, Math.round(props.count)) }, (_, i) => ({
    left: `${Math.floor(seeded(i, 1) * 800 - 400)}px`,
    delay: `${(seeded(i, 2) * 6 + 0.2).toFixed(2)}s`,
    duration: `${Math.floor(seeded(i, 3) * 8 + 4)}s`,
  })),
);
</script>

<template>
  <span
    v-for="(m, i) in meteors"
    :key="i"
    :class="cn('meteor land-fx', props.class)"
    :style="{ left: m.left, animationDelay: m.delay, animationDuration: m.duration, '--meteor-color': color }"
    aria-hidden="true"
  />
</template>

<style scoped>
.meteor {
  position: absolute;
  top: 0;
  height: 2px;
  width: 2px;
  border-radius: 9999px;
  background: var(--meteor-color);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
  transform: rotate(215deg);
  opacity: 0;
  animation: meteor 5s linear infinite;
  will-change: transform, opacity;
}

.meteor::before {
  content: '';
  position: absolute;
  top: 50%;
  width: 50px;
  height: 1px;
  transform: translateY(-50%);
  background: linear-gradient(90deg, var(--meteor-color), transparent);
}

@keyframes meteor {
  0% {
    transform: rotate(215deg) translateX(0);
    opacity: 0.7;
  }
  70% {
    opacity: 0.7;
  }
  100% {
    transform: rotate(215deg) translateX(-500px);
    opacity: 0;
  }
}
</style>
