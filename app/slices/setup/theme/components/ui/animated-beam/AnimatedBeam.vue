<script lang="ts" setup>
import { cn } from '#theme/utils';

/**
 * A light that travels along a path between two elements inside a shared
 * container. Adapted from Inspira UI's animated-beam: the theme's `cn`, the
 * SVG root exposed so useFxPause can pause the SMIL animation while the
 * section is off screen, and a `static` prop that draws the lit segment at
 * rest for reduced motion. Decorative: pointer-transparent, aria-hidden.
 */
interface AnimatedBeamProps {
  class?: string;
  containerRef: HTMLElement | null | undefined;
  fromRef: HTMLElement | null | undefined;
  toRef: HTMLElement | null | undefined;
  curvature?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  delay?: number;
  duration?: number;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
  /** Reduced motion: no travelling light, the gradient sits in the middle of the path. */
  static?: boolean;
}

const props = withDefaults(defineProps<AnimatedBeamProps>(), {
  curvature: 0,
  reverse: false,
  duration: 6,
  delay: 0,
  pathColor: 'rgba(255, 255, 255, 0.5)',
  pathWidth: 2,
  pathOpacity: 0.2,
  gradientStartColor: 'var(--land-fx-from, #d77b61)',
  gradientStopColor: 'var(--land-fx-to, #c9a1e4)',
  startXOffset: 0,
  startYOffset: 0,
  endXOffset: 0,
  endYOffset: 0,
  static: false,
});

const svg = useTemplateRef<SVGSVGElement>('svg');
defineExpose({ svg });

const id = `beam-${Math.random().toString(36).slice(2, 10)}`;
const isVertical = ref(false);
const isRightToLeft = ref(false);
const isBottomToTop = ref(false);

const x1 = computed(() => {
  const direction = props.reverse ? !isRightToLeft.value : isRightToLeft.value;
  return direction ? '90%; -10%;' : '10%; 110%;';
});
const x2 = computed(() => {
  const direction = props.reverse ? !isRightToLeft.value : isRightToLeft.value;
  return direction ? '100%; 0%;' : '0%; 100%;';
});
const y1 = computed(() => {
  const direction = props.reverse ? !isBottomToTop.value : isBottomToTop.value;
  return direction ? '90%; -10%;' : '10%; 110%;';
});
const y2 = computed(() => {
  const direction = props.reverse ? !isBottomToTop.value : isBottomToTop.value;
  return direction ? '100%; 0%;' : '0%; 100%;';
});

const pathD = ref('');
const svgDimensions = ref({ width: 0, height: 0 });

let resizeObserver: ResizeObserver | undefined;

function updatePath() {
  if (!props.containerRef || !props.fromRef || !props.toRef) return;
  const containerRect = props.containerRef.getBoundingClientRect();
  const rectA = props.fromRef.getBoundingClientRect();
  const rectB = props.toRef.getBoundingClientRect();

  svgDimensions.value = { width: containerRect.width, height: containerRect.height };

  const startX = rectA.left - containerRect.left + rectA.width / 2 + props.startXOffset;
  const startY = rectA.top - containerRect.top + rectA.height / 2 + props.startYOffset;
  const endX = rectB.left - containerRect.left + rectB.width / 2 + props.endXOffset;
  const endY = rectB.top - containerRect.top + rectB.height / 2 + props.endYOffset;

  isVertical.value = Math.abs(endY - startY) > Math.abs(endX - startX);
  isRightToLeft.value = endX < startX;
  isBottomToTop.value = endY < startY;

  const controlY = startY - props.curvature;
  pathD.value = `M ${startX},${startY} Q ${(startX + endX) / 2},${controlY} ${endX},${endY}`;
}

const stopEffect = watchEffect(() => {
  if (resizeObserver === undefined && props.containerRef) {
    resizeObserver = new ResizeObserver(() => updatePath());
    resizeObserver.observe(props.containerRef);
    updatePath();
    stopEffect();
  }
});

onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <svg
    ref="svg"
    fill="none"
    :width="svgDimensions.width"
    :height="svgDimensions.height"
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="`0 0 ${svgDimensions.width} ${svgDimensions.height}`"
    :class="cn('pointer-events-none absolute top-0 left-0 transform-gpu stroke-2', props.class)"
    aria-hidden="true"
  >
    <path :d="pathD" :stroke="pathColor" :stroke-width="pathWidth" :stroke-opacity="pathOpacity" stroke-linecap="round" />
    <path :d="pathD" :stroke-width="pathWidth" :stroke="`url(#${id})`" stroke-opacity="1" stroke-linecap="round" />
    <defs>
      <linearGradient
        :id="id"
        gradientUnits="userSpaceOnUse"
        :x1="props.static ? '30%' : '0%'"
        :x2="props.static ? '70%' : '0%'"
        :y1="props.static && isVertical ? '30%' : '0%'"
        :y2="props.static && isVertical ? '70%' : '0%'"
      >
        <stop :stop-color="gradientStartColor" stop-opacity="0" />
        <stop :stop-color="gradientStartColor" />
        <stop offset="32.5%" :stop-color="gradientStopColor" />
        <stop offset="100%" :stop-color="gradientStopColor" stop-opacity="0" />
        <template v-if="!props.static">
          <animate v-if="!isVertical" attributeName="x1" :values="x1" :dur="`${duration}s`" :begin="`${delay}s`" keyTimes="0; 1" keySplines="0.16 1 0.3 1" calcMode="spline" repeatCount="indefinite" />
          <animate v-if="!isVertical" attributeName="x2" :values="x2" :dur="`${duration}s`" :begin="`${delay}s`" keyTimes="0; 1" keySplines="0.16 1 0.3 1" calcMode="spline" repeatCount="indefinite" />
          <animate v-if="isVertical" attributeName="y1" :values="y1" :dur="`${duration}s`" :begin="`${delay}s`" keyTimes="0; 1" keySplines="0.16 1 0.3 1" calcMode="spline" repeatCount="indefinite" />
          <animate v-if="isVertical" attributeName="y2" :values="y2" :dur="`${duration}s`" :begin="`${delay}s`" keyTimes="0; 1" keySplines="0.16 1 0.3 1" calcMode="spline" repeatCount="indefinite" />
        </template>
      </linearGradient>
    </defs>
  </svg>
</template>
