<template>
  <section ref="fxRoot" class="land-cta" :aria-label="$t('final.region')">
    <div class="land-cta__scene" aria-hidden="true">
      <!-- A handful of dim meteors across the closing scene; none under reduced
           motion, paused while the section is off screen (effects #8). -->
      <div v-if="!fx.reducedMotion" class="land-cta__meteors">
        <Meteors :count="fx.meteorCount" />
      </div>
      <img
        class="land-cta__img"
        src="/landing/cta-scene-1200.webp"
        srcset="/landing/cta-scene-800.webp 800w, /landing/cta-scene-1200.webp 1200w, /landing/cta-scene-1920.webp 1920w, /landing/cta-scene-2880.webp 2880w"
        sizes="100vw"
        alt=""
        loading="lazy"
        decoding="async"
        width="3552"
        height="1792"
      />
      <div class="land-cta__veil" />
      <div class="land-cta__mark" :class="{ 'land-cta__mark--orbit': brand === 'orbit' }">
        <img
          v-if="brand === 'orbit'"
          src="/landing/brand/orbit-mark-cta.webp"
          width="640"
          height="557"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <LandingBrandLogo v-else variant="mark" :size="520" :label="null" />
      </div>
    </div>

    <div class="land-wrap land-cta__inner">
      <p class="land-eyebrow" data-reveal>
        <span class="land-num">05</span>{{ $t('final.eyebrow') }}
      </p>
      <h2 class="land-h2 land-cta__title land-reveal--blur" data-reveal style="--reveal-delay: 80ms">{{ $t('final.title') }}</h2>
      <p class="land-lede land-cta__lede" data-reveal style="--reveal-delay: 160ms">{{ $t('final.lede') }}</p>
      <div class="land-cta__actions" data-reveal style="--reveal-delay: 240ms">
        <NuxtLink v-if="authStore.isAuthenticated" to="/agents" class="land-btn land-btn--accent land-cta__btn">
          {{ $t('final.cta_console') }}
          <Icon name="arrow-right" :size="18" class="land-arrow" />
        </NuxtLink>
        <ShimmerButton v-else :as="NuxtLink" :to="startRoute" class="land-btn land-btn--accent land-cta__btn" background="var(--land-orange)" shimmer-color="rgba(255, 255, 255, 0.45)">
          {{ $t('final.cta_start') }}
          <Icon name="arrow-right" :size="18" class="land-arrow" />
        </ShimmerButton>
        <NuxtLink to="/agents" class="land-btn land-btn--ghost land-cta__btn">
          {{ $t('final.cta_agents') }}
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { NuxtLink } from '#components';

// Effect settings from the landing tokens; the meteors hold while the section
// is off screen or the tab is hidden.
const fx = useFxTokens();
const fxRoot = ref<HTMLElement | null>(null);
// 30 %, not the default 5 %: the technology row sits right above, and the
// meteors should not start while that loop is still the one in view.
useFxPause(fxRoot, { threshold: 0.3 });
const authStore = useAuthStore();
const { variant: brand } = useBrandVariant();
const { enabled: registrationEnabled, refresh: refreshRegistration } =
  useRegistrationEnabled();
if (!authStore.isAuthenticated) {
  await useAsyncData('landing-registration-enabled', () => refreshRegistration());
}
const startRoute = computed(() => (registrationEnabled.value ? '/register' : '/login'));
</script>

<style scoped>
.land-cta {
  position: relative;
  overflow: hidden;
  padding: clamp(6rem, 14vw, 11rem) 0 clamp(7rem, 16vw, 13rem);
  border-top: 1px solid var(--land-border);
  isolation: isolate;
}
.land-cta__scene {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
/* The meteor layer fades out well before the section edges, so a streak never
   ends in a hard cut against the border or the scene image. */
.land-cta__meteors {
  position: absolute;
  inset: 0;
  overflow: hidden;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 45%, #000 40%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 45%, #000 40%, transparent 100%);
}
.land-cta__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center bottom;
}
.land-cta__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, var(--land-bg) 0%, rgba(9, 7, 13, 0.3) 45%, rgba(9, 7, 13, 0.1) 100%);
}
.land-cta__mark {
  position: absolute;
  left: 50%;
  bottom: -14%;
  transform: translateX(-50%);
  opacity: 0.06;
  filter: blur(0.5px);
  animation: land-drift 24s ease-in-out infinite;
}
.land-cta__mark--orbit {
  opacity: 0.34;
  bottom: -8%;
  mix-blend-mode: screen;
}
.land-cta__mark--orbit img {
  display: block;
}
.land-cta__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1.25rem;
}
.land-cta__title {
  max-width: 24ch;
  font-size: clamp(2.25rem, 1.4rem + 4vw, 4.25rem);
}
.land-cta__lede {
  text-align: center;
}
.land-cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.land-cta__btn {
  height: 3.4rem;
  padding: 0 1.75rem;
  font-size: 1rem;
}
@media (max-width: 480px) {
  .land-cta__actions {
    flex-direction: column;
    width: 100%;
  }
}
</style>
