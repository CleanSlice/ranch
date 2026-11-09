<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '#theme/utils';

/**
 * A soft spot of light that follows the pointer inside one card. Adapted
 * from Inspira UI's card-spotlight: the theme's `cn`, no colour or border of
 * its own (the card around it is styled by the caller), and a `disabled`
 * prop for reduced motion and touch devices, where the overlay is simply
 * not rendered.
 */
const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
    slotClass?: HTMLAttributes['class'];
    gradientSize?: number;
    gradientColor?: string;
    gradientOpacity?: number;
    disabled?: boolean;
  }>(),
  {
    class: '',
    slotClass: '',
    gradientSize: 200,
    gradientColor: 'var(--land-fx-spot-color, rgba(245, 161, 107, 0.12))',
    gradientOpacity: 0.8,
    disabled: false,
  },
);

const far = () => -props.gradientSize * 10;
const mouseX = ref(far());
const mouseY = ref(far());

function onMouseMove(e: MouseEvent) {
  if (props.disabled) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  mouseX.value = e.clientX - rect.left;
  mouseY.value = e.clientY - rect.top;
}

function onMouseLeave() {
  mouseX.value = far();
  mouseY.value = far();
}

const backgroundStyle = computed(
  () =>
    `radial-gradient(circle at ${mouseX.value}px ${mouseY.value}px, ${props.gradientColor} 0%, rgba(0, 0, 0, 0) ${Math.round(props.gradientSize)}px)`,
);
</script>

<template>
  <div
    :class="cn('group relative overflow-hidden rounded-[inherit]', props.class)"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <div :class="cn('relative z-10', props.slotClass)">
      <slot />
    </div>
    <div
      v-if="!disabled"
      class="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      :style="{ background: backgroundStyle, opacity: gradientOpacity }"
      aria-hidden="true"
    />
  </div>
</template>
