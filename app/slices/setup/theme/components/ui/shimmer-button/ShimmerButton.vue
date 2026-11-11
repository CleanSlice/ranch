<script setup lang="ts">
import { cn } from '#theme/utils';

/**
 * A faint light that sweeps along the edge of a pill every few seconds.
 * Adapted from Inspira UI's shimmer-button: it renders whatever element the
 * caller asks for (`as` — a NuxtLink keeps its link semantics), carries no
 * colours of its own (the caller's classes paint the pill, `background`
 * fills the inner cut so only the rim shimmers) and animates transform
 * only. Paused through `animation-play-state`; `land-fx` for reduced motion.
 */
interface ShimmerButtonProps {
  as?: string | object;
  class?: string;
  shimmerColor?: string;
  shimmerSize?: string;
  /** CSS time for one sweep, e.g. '6s' or 'var(--land-fx-shimmer-duration)'. */
  shimmerDuration?: string;
  borderRadius?: string;
  /** The pill's own background, repeated on the inner cut layer. */
  background?: string;
}

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<ShimmerButtonProps>(), {
  as: 'button',
  shimmerColor: 'rgba(215, 123, 97, 0.35)',
  shimmerSize: '0.05em',
  shimmerDuration: 'var(--land-fx-shimmer-duration, 6s)',
  borderRadius: '999px',
  background: 'var(--land-text, #f8f5fa)',
});
</script>

<template>
  <component
    :is="as"
    v-bind="$attrs"
    :style="{
      '--spread': '90deg',
      '--shimmer-color': shimmerColor,
      '--radius': borderRadius,
      '--speed': shimmerDuration,
      '--cut': shimmerSize,
      '--bg': background,
    }"
    :class="
      cn(
        'shimmer-button land-fx group relative z-0 inline-flex transform-gpu cursor-pointer items-center justify-center overflow-hidden [border-radius:var(--radius)] [background:var(--bg)]',
        $props.class,
      )
    "
  >
    <span class="@container-[size] absolute inset-0 -z-30 overflow-visible blur-[2px]" aria-hidden="true">
      <span class="shimmer-slide absolute inset-0 aspect-[1] h-[100cqh] rounded-none [mask:none]">
        <span
          class="shimmer-spin absolute -inset-full w-auto [translate:0_0] rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]"
        />
      </span>
    </span>
    <slot />
    <span class="absolute inset-(--cut) -z-20 [border-radius:var(--radius)] [background:var(--bg)]" aria-hidden="true" />
  </component>
</template>

<style scoped>
@keyframes shimmer-btn-shimmer-slide {
  to {
    transform: translate(calc(100cqw - 100%), 0);
  }
}

@keyframes shimmer-btn-spin-around {
  0% {
    transform: translateZ(0) rotate(0);
  }
  15%,
  35% {
    transform: translateZ(0) rotate(90deg);
  }
  65%,
  85% {
    transform: translateZ(0) rotate(270deg);
  }
  100% {
    transform: translateZ(0) rotate(360deg);
  }
}

.shimmer-slide {
  animation: shimmer-btn-shimmer-slide var(--speed) ease-in-out infinite alternate;
}

.shimmer-spin {
  animation: shimmer-btn-spin-around calc(var(--speed) * 2) infinite linear;
}
</style>
