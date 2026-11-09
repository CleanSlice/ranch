<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '#theme/utils';

/**
 * A border glow that follows the pointer along the card's edge and flows
 * towards whichever neighbour the pointer is nearest to. Adapted from
 * Inspira UI's glowing-effect: `cn` comes from the theme, the angle tween is
 * a few lines of requestAnimationFrame instead of motion-v, and the gradient
 * is two stops the landing names through tokens rather than four fixed
 * colours. Decorative only — pointer-transparent and aria-hidden.
 */
interface Props {
  blur?: number;
  /** Share of the smaller side around the centre where the glow stays off. */
  inactiveZone?: number;
  /** Extra pixels around the card that still count as "near". */
  proximity?: number;
  /** Half-width of the lit arc, in degrees. */
  spread?: number;
  glow?: boolean;
  class?: HTMLAttributes['class'];
  disabled?: boolean;
  /** Seconds the arc takes to swing to a new pointer angle. */
  movementDuration?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
}

const props = withDefaults(defineProps<Props>(), {
  blur: 0,
  inactiveZone: 0.7,
  proximity: 0,
  spread: 20,
  glow: false,
  movementDuration: 2,
  borderWidth: 1,
  disabled: false,
  colorFrom: 'var(--land-fx-from, #d77b61)',
  colorTo: 'var(--land-fx-to, #c9a1e4)',
});

const containerRef = useTemplateRef<HTMLElement>('containerRef');
const lastPosition = ref({ x: 0, y: 0 });
let moveFrame = 0;
let tweenFrame = 0;

const containerStyles = computed(() => ({
  '--blur': `${props.blur}px`,
  '--spread': props.spread,
  '--start': '0',
  '--active': '0',
  '--glowingeffect-border-width': `${props.borderWidth}px`,
  '--repeating-conic-gradient-times': '5',
  '--gradient': `radial-gradient(circle, ${props.colorFrom} 10%, transparent 20%),
    repeating-conic-gradient(
      from 236.84deg at 50% 50%,
      ${props.colorFrom} 0%,
      ${props.colorTo} calc(50% / var(--repeating-conic-gradient-times)),
      ${props.colorFrom} calc(100% / var(--repeating-conic-gradient-times))
    )`,
}));

/** Ease-out standing in for Inspira's cubic-bezier(0.16, 1, 0.3, 1); on a 2 s swing the two are indistinguishable. */
const easeOut = (t: number) => 1 - (1 - t) ** 4;

function tweenAngle(element: HTMLElement, from: number, to: number, seconds: number) {
  cancelAnimationFrame(tweenFrame);
  const start = performance.now();
  const duration = Math.max(1, seconds * 1000);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    element.style.setProperty('--start', String(from + (to - from) * easeOut(t)));
    if (t < 1) tweenFrame = requestAnimationFrame(step);
  };
  tweenFrame = requestAnimationFrame(step);
}

function handleMove(e?: PointerEvent | { x: number; y: number }) {
  if (!containerRef.value) return;
  cancelAnimationFrame(moveFrame);
  moveFrame = requestAnimationFrame(() => {
    const element = containerRef.value;
    if (!element) return;
    const { left, top, width, height } = element.getBoundingClientRect();
    const mouseX = e?.x ?? lastPosition.value.x;
    const mouseY = e?.y ?? lastPosition.value.y;
    if (e) lastPosition.value = { x: mouseX, y: mouseY };

    const centerX = left + width * 0.5;
    const centerY = top + height * 0.5;
    const distanceFromCenter = Math.hypot(mouseX - centerX, mouseY - centerY);
    const inactiveRadius = 0.5 * Math.min(width, height) * props.inactiveZone;
    if (distanceFromCenter < inactiveRadius) {
      element.style.setProperty('--active', '0');
      return;
    }

    const isActive =
      mouseX > left - props.proximity &&
      mouseX < left + width + props.proximity &&
      mouseY > top - props.proximity &&
      mouseY < top + height + props.proximity;
    element.style.setProperty('--active', isActive ? '1' : '0');
    if (!isActive) return;

    const currentAngle = Number.parseFloat(element.style.getPropertyValue('--start')) || 0;
    const targetAngle = (180 * Math.atan2(mouseY - centerY, mouseX - centerX)) / Math.PI + 90;
    const angleDiff = ((targetAngle - currentAngle + 180) % 360) - 180;
    tweenAngle(element, currentAngle, currentAngle + angleDiff, props.movementDuration);
  });
}

const onPointerMove = (e: PointerEvent) => handleMove(e);
const onScroll = () => handleMove();

onMounted(() => {
  if (props.disabled) return;
  window.addEventListener('scroll', onScroll, { passive: true });
  document.body.addEventListener('pointermove', onPointerMove, { passive: true });
});

onUnmounted(() => {
  cancelAnimationFrame(moveFrame);
  cancelAnimationFrame(tweenFrame);
  window.removeEventListener('scroll', onScroll);
  document.body.removeEventListener('pointermove', onPointerMove);
});
</script>

<template>
  <div
    :class="
      cn(
        'pointer-events-none absolute -inset-px hidden rounded-[inherit] border opacity-0 transition-opacity',
        glow && 'opacity-100',
        disabled && 'block!',
      )
    "
    aria-hidden="true"
  />
  <div
    ref="containerRef"
    :style="containerStyles"
    :class="
      cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] opacity-100 transition-opacity',
        glow && 'opacity-100',
        blur > 0 && 'blur-(--blur)',
        props.class,
        disabled && 'hidden!',
      )
    "
    aria-hidden="true"
  >
    <div
      class="glow rounded-[inherit] after:absolute after:inset-[calc(-1*var(--glowingeffect-border-width))] after:rounded-[inherit] after:mask-[linear-gradient(#0000,#0000),conic-gradient(from_calc((var(--start)-var(--spread))*1deg),#00000000_0deg,#fff,#00000000_calc(var(--spread)*2deg))] after:bg-fixed after:mask-intersect after:[mask-clip:padding-box,border-box] after:opacity-(--active) after:transition-opacity after:duration-300 after:content-[''] after:[background:var(--gradient)] after:[border:var(--glowingeffect-border-width)_solid_transparent]"
    />
  </div>
</template>
