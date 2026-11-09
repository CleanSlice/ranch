<template>
  <section class="land-hero" :aria-label="$t('hero.region')">
    <LandingHeroAtmosphere />
    <LandingHeroConstellation />

    <div class="land-hero__inner land-wrap">
      <div class="land-hero__copy">
        <p
          class="land-eyebrow land-hero__eyebrow land-enter"
          style="--enter-delay: 100ms; --enter-dur: 700ms"
        >
          <span class="land-hero__pulse" aria-hidden="true" />
          {{ $t('hero.eyebrow') }}
        </p>

        <h1 class="land-hero__title">
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

      <div class="land-hero__stage land-enter land-enter--stage" style="--enter-delay: 620ms; --enter-dur: 1000ms">
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
  font-size: clamp(2.5rem, 1rem + 4.9vw, 4.4rem);
  line-height: 0.98;
  letter-spacing: -0.035em;
  font-weight: 600;
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
  width: 100%;
  max-width: 1120px;
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
