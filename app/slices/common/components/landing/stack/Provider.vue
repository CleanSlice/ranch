<template>
  <!-- What RANCH is built on, as a slow monochrome row before the closing call
       to action. Only real foundations, never customers (FR-013); the marks
       are icon + name in the current colour, no third-party logo files. -->
  <section ref="fxRoot" class="land-stack" :aria-label="$t('stack.caption')">
    <div class="land-wrap land-stack__inner" data-reveal>
      <p class="land-eyebrow land-stack__caption">{{ $t('stack.caption') }}</p>
      <Marquee pause-on-hover :repeat="3" class="land-stack__marquee">
        <span v-for="item in stack" :key="item.name" class="land-stack__item">
          <Icon :name="item.icon" :size="18" />
          <span>{{ item.name }}</span>
        </span>
      </Marquee>
    </div>
  </section>
</template>

<script setup lang="ts">
// Product and project names: not copy, so they stay as written.
const stack = [
  { name: 'Kubernetes', icon: 'boxes' },
  { name: 'Argo Workflows', icon: 'workflow' },
  { name: 'Docker', icon: 'container' },
  { name: 'Socket.IO', icon: 'radio' },
  { name: 'Bridle', icon: 'bot' },
];

// The marquee is a loop: it holds while the row is off screen or the tab is
// hidden (useFxPause), and under the pointer (pauseOnHover).
const fxRoot = ref<HTMLElement | null>(null);
useFxPause(fxRoot);
</script>

<style scoped>
.land-stack {
  padding: clamp(2.5rem, 6vw, 4rem) 0;
  border-top: 1px solid var(--land-border);
}
.land-stack__inner {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  align-items: center;
}
.land-stack__caption {
  color: var(--land-text-3);
}
.land-stack__marquee {
  width: 100%;
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.land-stack__item {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 1.75rem;
  font-family: var(--land-mono);
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  color: var(--land-text-2);
  white-space: nowrap;
}
.land-stack__item :deep(svg) {
  color: var(--land-text-3);
}
</style>
