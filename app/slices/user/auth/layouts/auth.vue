<template>
  <div class="landing gate" @animationend="onLandingAnimationEnd">
    <LandingHeroAtmosphere />

    <header class="gate__bar land-wrap">
      <NuxtLink
        to="/"
        class="gate__brand land-glass land-enter land-enter--down"
        :aria-label="$t('app_name')"
        style="--enter-dur: 650ms"
      >
        <LandingBrandLogo variant="full" :size="30" :label="null" />
      </NuxtLink>
      <NuxtLink
        to="/"
        class="gate__back land-glass land-enter land-enter--down"
        style="--enter-dur: 650ms; --enter-delay: 60ms"
        :aria-label="$t('gate.back')"
      >
        <Icon name="arrow-left" :size="14" />
        <span class="gate__back-text">{{ $t('gate.back') }}</span>
      </NuxtLink>
    </header>

    <main class="gate__grid land-wrap">
      <!-- The story: where this screen sits in the product -->
      <section class="gate__story" :aria-label="$t('gate.story_region')">
        <p class="land-eyebrow land-enter" style="--enter-delay: 100ms">
          <span class="land-num">01</span>{{ $t('gate.eyebrow') }}
        </p>
        <h2 class="gate__title land-enter" style="--enter-delay: 180ms">
          {{ $t(isRegister ? 'gate.register_title' : 'gate.login_title') }}
        </h2>
        <p class="land-lede gate__lede land-enter" style="--enter-delay: 280ms">
          {{ $t(isRegister ? 'gate.register_lede' : 'gate.login_lede') }}
        </p>
        <div class="gate__route land-enter" style="--enter-delay: 380ms">
          <AuthGateRoute :stage="stage" :row="narrow" />
        </div>
      </section>

      <!-- The panel: the real form -->
      <div class="gate__stage land-enter land-enter--stage" style="--enter-delay: 420ms; --enter-dur: 1000ms">
        <div class="gate__glow" aria-hidden="true" />
        <div class="gate__panel">
          <div class="gate__panel-head">
            <span class="gate__kicker">
              <span class="gate__pulse" aria-hidden="true" />
              {{ $t('gate.kicker') }}
            </span>
            <span class="gate__mono">jwt · socket.io</span>
          </div>

          <nav class="gate__switch" :aria-label="$t('gate.switch_label')">
            <NuxtLink to="/login" class="gate__switch-item" :class="{ 'is-active': !isRegister }">
              {{ $t('account.sign_in') }}
            </NuxtLink>
            <NuxtLink to="/register" class="gate__switch-item" :class="{ 'is-active': isRegister }">
              {{ $t('account.create_account') }}
            </NuxtLink>
          </nav>

          <slot />
        </div>
      </div>
    </main>

    <footer class="gate__foot land-wrap land-enter" style="--enter-delay: 700ms">
      <span>{{ $t('gate.footer', { year }) }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { provideGateStage } from '#auth/composables/useGateStage';

useLandingChrome();

const route = useRoute();
const isRegister = computed(() => route.path.startsWith('/register'));
const year = new Date().getFullYear();

// The route visualization follows the form (see useGateStage).
const stage = provideGateStage();
watch(() => route.path, () => (stage.value = 'idle'));

// Phones get the route as a compact row above the panel.
const narrow = ref(false);
let mq: MediaQueryList | null = null;
function onMq() {
  narrow.value = !!mq?.matches;
}
onMounted(() => {
  mq = window.matchMedia('(max-width: 1023px)');
  onMq();
  mq.addEventListener('change', onMq);
});
onBeforeUnmount(() => mq?.removeEventListener('change', onMq));
</script>

<style scoped>
.gate {
  position: relative;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  isolation: isolate;
}
.gate > :deep(.land-atmo),
.gate > :deep(.land-const) {
  z-index: 0;
}
.gate__bar,
.gate__grid,
.gate__foot {
  position: relative;
  z-index: 1;
}
.gate__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 1rem;
}
.gate__brand {
  display: inline-flex;
  align-items: center;
  height: 3.25rem;
  padding: 0 1.1rem 0 0.6rem;
  border-radius: 999px;
}
.gate__back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 3rem;
  padding: 0 1rem;
  border-radius: 999px;
  color: #c9c0d0;
  font-size: 0.85rem;
  text-decoration: none;
  transition: color 0.3s var(--land-ease);
}
.gate__back:hover {
  color: var(--land-text);
}
.gate__brand:focus-visible,
.gate__back:focus-visible,
.gate__switch-item:focus-visible {
  outline: 2px solid var(--land-orange);
  outline-offset: 2px;
}
@media (max-width: 480px) {
  .gate__back {
    width: 3rem;
    padding: 0;
    justify-content: center;
  }
  .gate__back-text {
    display: none;
  }
}

.gate__grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
  align-content: start;
  padding: 2.5rem 0 3rem;
}
@media (min-width: 1024px) {
  .gate__grid {
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 460px);
    gap: clamp(3rem, 8vw, 8rem);
    align-items: center;
    align-content: center;
    padding: 2rem 0 4rem;
  }
}

.gate__story {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 34rem;
}
@media (min-width: 1024px) {
  .gate__story {
    gap: 2rem;
  }
}
.gate__title {
  margin: 0;
  /* The landing's display face (Unbounded), a step smaller than the Geist
     size because it runs wider. */
  font-family: var(--land-display);
  font-size: clamp(1.6rem, 0.9rem + 2.4vw, 2.6rem);
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 700;
  color: #fbf8fd;
  text-wrap: balance;
}
.gate__lede {
  max-width: 28rem;
}
.gate__route {
  margin-top: 0.25rem;
}

.gate__stage {
  position: relative;
}
.gate__glow {
  position: absolute;
  left: 10%;
  right: 10%;
  top: -8%;
  height: 50%;
  border-radius: 999px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(245, 161, 107, 0.3) 0%, rgba(245, 161, 107, 0) 70%);
  filter: blur(30px);
  pointer-events: none;
}
.gate__panel {
  position: relative;
  border-radius: 1.4rem;
  background: var(--land-panel);
  color: var(--land-panel-text);
  box-shadow:
    0 40px 120px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.14);
  padding: 1.5rem 1.4rem 1.6rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
@media (min-width: 640px) {
  .gate__panel {
    padding: 1.75rem 2rem 2rem;
  }
}
.gate__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.gate__kicker {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--land-panel-text-2);
}
.gate__pulse {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--land-orange);
  box-shadow: 0 0 10px rgba(245, 161, 107, 0.9);
}
.gate__mono {
  font-family: var(--land-mono);
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #8a7f94;
  white-space: nowrap;
}
.gate__switch {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: #efeaf3;
}
.gate__switch-item {
  flex: 1;
  text-align: center;
  padding: 0.6rem 0;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #3b3344;
  text-decoration: none;
  transition:
    background-color 0.3s var(--land-ease),
    color 0.3s var(--land-ease);
}
.gate__switch-item:hover {
  color: var(--land-panel-text);
}
.gate__switch-item.is-active {
  background: var(--land-panel-text);
  color: var(--land-text);
}

.gate__foot {
  padding-bottom: 1.5rem;
  font-family: var(--land-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--land-text-3);
}
</style>
