<template>
  <section class="land-hero" :aria-label="$t('hero.region')">
    <LandingHeroAtmosphere />

    <div class="land-hero__inner land-wrap">
      <div class="land-hero__copy">
        <p
          class="land-eyebrow land-hero__eyebrow land-enter"
          style="--enter-delay: 100ms; --enter-dur: 700ms"
        >
          <span class="land-hero__pulse" aria-hidden="true" />
          {{ $t('hero.eyebrow') }}
        </p>

        <h1 class="land-hero__title land-ink">
          <!-- No entrance animation on the headline or the lede: they are the
               page's largest text and must be on screen at first paint, not
               fade in behind the brand mark (LCP stays the hero, FR-007). -->
          <span class="land-hero__line">
            {{ $t('hero.title_line1') }}
          </span>
          <span class="land-hero__line">
            {{ $t('hero.title_line2') }}
          </span>
        </h1>

        <p class="land-lede land-hero__lede">
          {{ $t('hero.lede') }}
        </p>

        <div class="land-hero__cta land-enter" style="--enter-delay: 500ms">
          <NuxtLink
            v-if="authStore.isAuthenticated"
            to="/agents"
            class="land-btn land-btn--primary"
          >
            {{ $t('hero.cta_console') }}
            <Icon name="arrow-right" :size="16" class="land-arrow" />
          </NuxtLink>
          <!-- A faint light sweeps the rim of the primary pill every few seconds;
               it stays a NuxtLink with the same classes (effects #6). -->
          <ShimmerButton v-else :as="NuxtLink" :to="startRoute" class="land-btn land-btn--primary" background="var(--land-text)">
            {{ $t('hero.cta_start') }}
            <Icon name="arrow-right" :size="16" class="land-arrow" />
          </ShimmerButton>
          <a href="#platform" class="land-btn land-btn--ghost" @click="scrollTo('platform', $event)">
            {{ $t('hero.cta_platform') }}
          </a>
        </div>
      </div>

      <div ref="stageWrapEl" class="land-hero__stage land-enter land-enter--stage" style="--enter-delay: 620ms; --enter-dur: 1000ms">
        <!-- A beam of light falls from above the headline into the demo panel
             and pools along its top edge; short sparks run down its last
             stretch, one landing every 1.2 s. It sits behind the copy and the panel, holds
             while the hero is off screen and is still under reduced motion. -->
        <span class="land-hero__beam land-fx" aria-hidden="true">
          <span class="land-hero__beam-haze" />
          <span class="land-hero__beam-glow" />
          <span class="land-hero__beam-core" />
          <span v-for="i in 2" :key="i" class="land-hero__beam-spark" :style="{ '--i': i - 1 }" />
          <span class="land-hero__beam-pool" />
          <span class="land-hero__beam-edge" />
        </span>
        <LandingHeroStage :agent="featured" :origin="origin" />
      </div>

      <ol class="land-hero__strip land-enter" style="--enter-delay: 800ms">
        <li v-for="(step, i) in strip" :key="step">
          <span class="land-num" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
          {{ $t(step) }}
        </li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { IAgentData } from '#agent/stores/agent';
import { NuxtLink } from '#components';

const agentStore = useAgentStore();
const authStore = useAuthStore();

// The beam's loops hold while the stage is off screen or the tab is hidden.
// Registered before the first await: lifecycle hooks need the instance.
const stageWrapEl = ref<HTMLElement | null>(null);
useFxPause(stageWrapEl);

// Only the hero image is worth preloading; everything below the fold lazy-loads.
useHead({
  link: [
    {
      rel: 'preload',
      as: 'image',
      href: '/landing/hero-desktop-1600.webp',
      imagesrcset: '/landing/hero-desktop-1600.webp 1600w, /landing/hero-desktop-2560.webp 2560w',
      imagesizes: '100vw',
      media: '(min-width: 768px)',
    },
    {
      rel: 'preload',
      as: 'image',
      href: '/landing/hero-mobile-720.webp',
      imagesrcset: '/landing/hero-mobile-720.webp 720w, /landing/hero-mobile-1080.webp 1080w',
      imagesizes: '100vw',
      media: '(max-width: 767px)',
    },
  ],
});

await useAsyncData('landing-agents', () => agentStore.fetchPublic());

/** The page's own origin, the same on the server and in the browser. */
const origin = useRequestURL().origin;

/**
 * Only the agents the hub would actually let an anonymous visitor talk to
 * from this page: public, and this origin on their allowed list. Previewing
 * any other agent ends in ORIGIN_NOT_ALLOWED in the middle of the landing
 * page, and a made-up demo card is not an honest substitute (CLEAN-179).
 */
const available = computed<IAgentData[]>(() =>
  agentStore.publicAgents.filter((a) => a.allowedOrigins.includes(origin)),
);
const featured = computed<IAgentData | null>(() => available.value[0] ?? null);

const { enabled: registrationEnabled, refresh: refreshRegistration } =
  useRegistrationEnabled();
if (!authStore.isAuthenticated) {
  await useAsyncData('landing-registration-enabled', () => refreshRegistration());
}
const startRoute = computed(() => (registrationEnabled.value ? '/register' : '/login'));

const strip = ['hero.strip_configure', 'hero.strip_deploy', 'hero.strip_interact'];

function scrollTo(id: string, event: MouseEvent) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', `#${id}`);
}
</script>

<style scoped>
.land-hero {
  position: relative;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  isolation: isolate;
}
.land-hero__inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: clamp(6.5rem, 14vh, 9.5rem);
  padding-bottom: 2.5rem;
  gap: clamp(2.5rem, 6vh, 4.5rem);
}
.land-hero__copy {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1.5rem;
  max-width: 74rem;
}
.land-hero__eyebrow {
  height: 2rem;
  padding: 0 0.9rem 0 0.75rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(19, 14, 25, 0.45);
  backdrop-filter: blur(10px);
  margin: 0;
}
.land-hero__pulse {
  position: relative;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--land-orange);
  box-shadow: 0 0 10px rgba(245, 161, 107, 0.9);
}
.land-hero__pulse::after {
  content: '';
  position: absolute;
  inset: -0.3rem;
  border-radius: 999px;
  border: 1px solid rgba(245, 161, 107, 0.6);
  animation: land-pulse-ring 2.6s ease-out infinite;
}
.land-hero__title {
  margin: 0;
  /* Unbounded is about a third wider than Geist, so the size comes down to
     keep the second line on one row at 1440 (FR-007). */
  font-family: var(--land-display);
  font-size: clamp(1.9rem, 0.75rem + 3.5vw, 3.3rem);
  line-height: 1.04;
  letter-spacing: -0.025em;
  font-weight: 700;
  color: #fbf8fd;
  text-wrap: balance;
}
.land-hero__line {
  display: block;
}
.land-hero__lede {
  text-align: center;
  max-width: 38rem;
}
.land-hero__cta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.25rem;
}
@media (max-width: 480px) {
  .land-hero__cta {
    flex-direction: column;
    width: 100%;
  }
  .land-hero__cta .land-btn {
    width: 100%;
  }
}
.land-hero__stage {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1120px;
}

/* ── The beam ────────────────────────────────────────────────────────
   Lives in the stage's stacking context at z-index -1: over the atmosphere,
   under the panel; the copy above it is lifted one level so the letters
   cover the light instead of being washed by it. */
.land-hero__beam {
  --beam-h: 46rem;
  position: absolute;
  left: 50%;
  bottom: calc(100% - 1px);
  z-index: -1;
  width: min(46rem, 92%);
  height: var(--beam-h);
  transform: translateX(-50%);
  pointer-events: none;
  animation: land-beam-breathe 4s ease-in-out infinite;
}
.land-hero__beam > * {
  position: absolute;
}
.land-hero__beam-haze {
  inset: 0;
  background: radial-gradient(
    ellipse 34% 58% at 50% 100%,
    rgba(201, 161, 228, 0.22) 0%,
    rgba(245, 161, 107, 0.1) 42%,
    rgba(245, 161, 107, 0) 74%
  );
}
/* Behind the headline the beam is a wide soft shaft; it sharpens into a
   hard line only in the last stretch above the panel, below the copy. */
.land-hero__beam-glow {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 9rem;
  margin-left: -4.5rem;
  background: linear-gradient(
    to top,
    rgba(255, 226, 204, 0.7) 0%,
    rgba(245, 161, 107, 0.42) 22%,
    rgba(201, 161, 228, 0.26) 58%,
    rgba(201, 161, 228, 0) 100%
  );
  filter: blur(26px);
}
.land-hero__beam-core {
  left: 50%;
  bottom: 0;
  width: 2px;
  height: 8.5rem;
  margin-left: -1px;
  border-radius: 2px;
  background: linear-gradient(
    to top,
    #ffffff 0%,
    #ffe0c8 22%,
    rgba(245, 161, 107, 0.8) 55%,
    rgba(245, 161, 107, 0) 100%
  );
  box-shadow: 0 0 14px 1px rgba(245, 161, 107, 0.35);
  -webkit-mask-image: linear-gradient(to top, #000 0%, #000 40%, rgba(0, 0, 0, 0) 100%);
  mask-image: linear-gradient(to top, #000 0%, #000 40%, rgba(0, 0, 0, 0) 100%);
}
.land-hero__beam-spark {
  left: 50%;
  top: 0;
  width: 2px;
  height: 2rem;
  margin-left: -1px;
  border-radius: 2px;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0), #ffffff);
  box-shadow: 0 0 10px 1px rgba(255, 226, 204, 0.8);
  opacity: 0;
  animation: land-beam-spark 2.4s cubic-bezier(0.55, 0, 0.9, 0.55) infinite;
  animation-delay: calc(var(--i) * 1.2s);
}
/* Where the beam lands, the light spreads along the panel's top edge. */
.land-hero__beam-pool {
  left: 50%;
  bottom: -0.75rem;
  width: 150%;
  height: 12rem;
  transform: translateX(-50%);
  background: radial-gradient(
    ellipse 50% 100% at 50% 100%,
    rgba(255, 240, 228, 0.95) 0%,
    rgba(245, 161, 107, 0.6) 16%,
    rgba(201, 161, 228, 0.2) 46%,
    rgba(201, 161, 228, 0) 72%
  );
  animation: land-beam-pool 1.2s ease-out infinite;
}
.land-hero__beam-edge {
  left: 50%;
  bottom: 0;
  width: 130%;
  height: 2px;
  transform: translateX(-50%);
  background: linear-gradient(
    90deg,
    rgba(245, 161, 107, 0) 0%,
    rgba(245, 161, 107, 0.75) 26%,
    #ffffff 50%,
    rgba(245, 161, 107, 0.75) 74%,
    rgba(245, 161, 107, 0) 100%
  );
  filter: blur(0.4px);
}
@keyframes land-beam-breathe {
  0%,
  100% {
    opacity: 0.86;
  }
  50% {
    opacity: 1;
  }
}
@keyframes land-beam-spark {
  0% {
    opacity: 0;
    transform: translateY(calc(var(--beam-h) - 9rem));
  }
  25% {
    opacity: 0.9;
  }
  88% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(calc(var(--beam-h) - 2rem));
  }
}
@keyframes land-beam-pool {
  0% {
    opacity: 1;
  }
  35% {
    opacity: 0.8;
  }
  100% {
    opacity: 0.72;
  }
}
@media (max-width: 640px) {
  .land-hero__beam {
    --beam-h: 38rem;
  }
  .land-hero__beam-pool {
    width: 110%;
    height: 7rem;
  }
  .land-hero__beam-edge {
    width: 100%;
  }
}
.land-hero__strip {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem 1.75rem;
  font-family: var(--land-mono);
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--land-text-3);
}
.land-hero__strip li {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}
.land-hero__strip li + li::before {
  content: '';
  width: 2.5rem;
  height: 1px;
  background: var(--land-border-2);
  margin-right: 1rem;
}
@media (max-width: 640px) {
  .land-hero__strip {
    gap: 0.6rem 1.25rem;
  }
  .land-hero__strip li + li::before {
    display: none;
  }
}
.land-hero__strip .land-num {
  font-family: var(--land-pixel);
  font-size: 0.85rem;
  letter-spacing: 0;
  color: var(--land-orange);
}
</style>
