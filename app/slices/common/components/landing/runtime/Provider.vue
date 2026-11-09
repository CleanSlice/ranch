<template>
  <section id="infrastructure" ref="rootEl" class="land-rt">
    <div class="land-wrap">
      <header class="land-rt__head">
        <p class="land-eyebrow" data-reveal>
          <span class="land-num">04</span>{{ $t('runtime.eyebrow') }}
        </p>
        <h2 class="land-h2" data-reveal style="--reveal-delay: 80ms">{{ $t('runtime.title') }}</h2>
        <p class="land-lede" data-reveal style="--reveal-delay: 160ms">{{ $t('runtime.lede') }}</p>
      </header>

      <div class="land-rt__board" data-reveal style="--reveal-delay: 200ms">
        <!-- Routes between stations (desktop: horizontal; mobile: vertical) -->
        <svg class="land-rt__routes land-rt__routes--h" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="20" x2="1200" y2="20" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
          <line x1="0" y1="20" x2="1200" y2="20" stroke="url(#land-rt-grad)" stroke-width="1.5" stroke-dasharray="6 14" class="land-rt__flow" />
          <defs>
            <linearGradient id="land-rt-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#C9A1E4" />
              <stop offset="1" stop-color="#F5A16B" />
            </linearGradient>
          </defs>
        </svg>

        <ol class="land-rt__stations">
          <li
            v-for="(station, i) in stations"
            :key="station.key"
            class="land-rt__station"
            :class="{ 'is-active': active === i, 'is-done': active > i }"
          >
            <span class="land-rt__port" aria-hidden="true"><span /></span>
            <div class="land-rt__card">
              <div class="land-rt__card-head">
                <span class="land-rt__icon"><Icon :name="station.icon" :size="16" /></span>
                <span class="land-rt__index">{{ String(i + 1).padStart(2, '0') }}</span>
              </div>
              <h3 class="land-rt__title">{{ $t(`runtime.${station.key}_title`) }}</h3>
              <p class="land-rt__body">{{ $t(`runtime.${station.key}_body`) }}</p>
              <ul class="land-rt__chips" aria-label="">
                <li v-for="chip in station.chips" :key="chip">{{ chip }}</li>
              </ul>
            </div>
          </li>
        </ol>
      </div>

      <p class="land-rt__note" data-reveal style="--reveal-delay: 260ms">
        <Icon name="shield-check" :size="14" />
        {{ $t('runtime.note') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
const stations = [
  { key: 'config', icon: 'sliders-horizontal', chips: ['image:tag', 'cpu / memory', 'isPublic'] },
  { key: 'argo', icon: 'workflow', chips: ['Workflow', 'Pending → Running', 'Succeeded'] },
  { key: 'k8s', icon: 'boxes', chips: ['k3s', 'Pod', 'ContainerCreating'] },
  { key: 'agent', icon: 'message-square', chips: ['Bridle hub', 'socket.io', 'JWT'] },
];

// The light travels the pipeline only while the board is on screen, and not
// at all under reduced motion (the final station stays lit instead).
const rootEl = ref<HTMLElement | null>(null);
const active = ref(stations.length - 1);
let timer: ReturnType<typeof setInterval> | null = null;
let io: IntersectionObserver | null = null;

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  io = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        if (timer) return;
        active.value = 0;
        timer = setInterval(() => {
          active.value = (active.value + 1) % (stations.length + 1);
        }, 1600);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    { threshold: 0.3 },
  );
  if (rootEl.value) io.observe(rootEl.value);
});
onBeforeUnmount(() => {
  io?.disconnect();
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.land-rt {
  position: relative;
  padding: clamp(5rem, 10vw, 8rem) 0;
}
.land-rt__head {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  max-width: 44rem;
  margin-bottom: clamp(3rem, 6vw, 4.5rem);
}
.land-rt__board {
  position: relative;
  padding: 1.5rem;
  border-radius: 1.5rem;
  background:
    radial-gradient(50% 60% at 50% 100%, rgba(245, 161, 107, 0.12) 0%, rgba(245, 161, 107, 0) 70%),
    linear-gradient(180deg, rgba(37, 27, 43, 0.35), rgba(19, 14, 25, 0.8));
  border: 1px solid var(--land-border);
}
@media (min-width: 1024px) {
  .land-rt__board {
    padding: 3rem 2rem 2rem;
  }
}
.land-rt__routes {
  position: absolute;
  left: 2rem;
  right: 2rem;
  top: calc(3rem + 0.625rem - 20px);
  height: 40px;
  width: calc(100% - 4rem);
  display: none;
}
@media (min-width: 1024px) {
  .land-rt__routes--h {
    display: block;
  }
}
.land-rt__flow {
  animation: land-dash 2.4s linear infinite;
}
.land-rt__stations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  position: relative;
}
@media (min-width: 640px) {
  .land-rt__stations {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (min-width: 1024px) {
  .land-rt__stations {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1.5rem;
  }
}
.land-rt__station {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.land-rt__port {
  display: none;
  align-self: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  border: 1px solid var(--land-border-2);
  background: var(--land-bg);
  margin-bottom: 1.5rem;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: border-color 0.5s var(--land-ease);
}
.land-rt__port span {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--land-text-3);
  transition:
    background-color 0.5s var(--land-ease),
    box-shadow 0.5s var(--land-ease);
}
@media (min-width: 1024px) {
  .land-rt__port {
    display: inline-flex;
  }
}
.land-rt__station.is-active .land-rt__port {
  border-color: rgba(245, 161, 107, 0.7);
}
.land-rt__station.is-active .land-rt__port span {
  background: var(--land-orange);
  box-shadow: 0 0 14px rgba(245, 161, 107, 0.9);
}
.land-rt__station.is-done .land-rt__port span {
  background: var(--land-lavender);
}
.land-rt__card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.25rem;
  border-radius: 1rem;
  background: rgba(19, 14, 25, 0.7);
  border: 1px solid var(--land-border);
  transition:
    border-color 0.5s var(--land-ease),
    box-shadow 0.5s var(--land-ease),
    transform 0.5s var(--land-ease);
}
.land-rt__station.is-active .land-rt__card {
  border-color: rgba(245, 161, 107, 0.45);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(245, 161, 107, 0.15);
  transform: translateY(-4px);
}
.land-rt__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.land-rt__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 0.65rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--land-border);
  color: var(--land-lavender);
}
.land-rt__station.is-active .land-rt__icon {
  color: var(--land-orange);
}
.land-rt__index {
  font-family: var(--land-pixel);
  font-size: 0.85rem;
  color: var(--land-text-3);
}
.land-rt__title {
  margin: 0.2rem 0 0;
  font-size: 1.05rem;
  font-weight: 600;
}
.land-rt__body {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--land-text-2);
}
.land-rt__chips {
  list-style: none;
  margin: auto 0 0;
  padding: 0.6rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.land-rt__chips li {
  font-family: var(--land-mono);
  font-size: 0.66rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--land-border);
  color: var(--land-text-3);
}
.land-rt__note {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1.25rem 0 0;
  font-size: 0.82rem;
  color: var(--land-text-3);
}
</style>
