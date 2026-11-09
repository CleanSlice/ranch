<template>
  <section id="how" ref="fxRoot" class="land-steps">
    <div class="land-wrap">
      <header class="land-steps__head">
        <p class="land-eyebrow" data-reveal>
          <span class="land-num">02</span>{{ $t('steps.eyebrow') }}
        </p>
        <h2 class="land-h2 land-reveal--blur" data-reveal style="--reveal-delay: 80ms">{{ $t('steps.title') }}</h2>
        <p class="land-lede" data-reveal style="--reveal-delay: 160ms">{{ $t('steps.lede') }}</p>
      </header>

      <div ref="trackEl" class="land-steps__track">
        <div class="land-steps__line" aria-hidden="true" />
        <!-- One light runs Configure → Deploy → Chat along the markers; paused while
             the section is off screen, static under reduced motion (effects #3). -->
        <AnimatedBeam :container-ref="trackEl" :from-ref="m1" :to-ref="m2" :duration="fx.beamSeconds" :static="fx.reducedMotion" :path-opacity="0" />
        <AnimatedBeam :container-ref="trackEl" :from-ref="m2" :to-ref="m3" :duration="fx.beamSeconds" :delay="fx.beamSeconds / 2" :static="fx.reducedMotion" :path-opacity="0" />

        <!-- 01 Configure -->
        <article class="land-steps__step" data-reveal>
          <div ref="m1" class="land-steps__marker"><span class="land-num">01</span></div>
          <div class="land-steps__ui land-steps__ui--form" aria-hidden="true">
            <div class="land-steps__row">
              <span class="land-steps__label">{{ $t('steps.ui_template') }}</span>
              <span class="land-steps__select">
                <LandingBrandLogo variant="symbol" :size="14" mono :label="null" />
                ranch/agent-base:1.4
                <Icon name="chevron-down" :size="12" />
              </span>
            </div>
            <div class="land-steps__row">
              <span class="land-steps__label">{{ $t('steps.ui_resources') }}</span>
              <span class="land-steps__chips">
                <span class="land-steps__chip is-on">500m CPU</span>
                <span class="land-steps__chip is-on">1Gi</span>
                <span class="land-steps__chip">2Gi</span>
              </span>
            </div>
            <div class="land-steps__row">
              <span class="land-steps__label">{{ $t('steps.ui_access') }}</span>
              <span class="land-steps__toggle"><span /></span>
            </div>
            <span class="land-steps__submit">{{ $t('steps.ui_deploy') }} <Icon name="arrow-right" :size="12" /></span>
          </div>
          <h3 class="land-steps__title">{{ $t('steps.configure_title') }}</h3>
          <p class="land-steps__body">{{ $t('steps.configure_body') }}</p>
        </article>

        <!-- 02 Deploy -->
        <article class="land-steps__step land-steps__step--mid" data-reveal style="--reveal-delay: 140ms">
          <div ref="m2" class="land-steps__marker"><span class="land-num">02</span></div>
          <div class="land-steps__ui land-steps__ui--flow" aria-hidden="true">
            <div class="land-steps__flow">
              <span class="land-steps__node is-done"><Icon name="check" :size="11" />{{ $t('steps.ui_flow_argo') }}</span>
              <span class="land-steps__edge" />
              <span class="land-steps__node is-done"><Icon name="check" :size="11" />{{ $t('steps.ui_flow_pod') }}</span>
              <span class="land-steps__edge is-live" />
              <span class="land-steps__node is-active"><span class="land-steps__spark" />{{ $t('steps.ui_flow_container') }}</span>
              <span class="land-steps__edge" />
              <span class="land-steps__node">{{ $t('steps.ui_flow_online') }}</span>
            </div>
            <div class="land-steps__log">
              <span>workflow/agent-7f2c · <em>Running</em></span>
              <span>pod/agent-7f2c-main · ContainerCreating</span>
            </div>
          </div>
          <h3 class="land-steps__title">{{ $t('steps.deploy_title') }}</h3>
          <p class="land-steps__body">{{ $t('steps.deploy_body') }}</p>
        </article>

        <!-- 03 Interact -->
        <article class="land-steps__step" data-reveal style="--reveal-delay: 280ms">
          <div ref="m3" class="land-steps__marker"><span class="land-num">03</span></div>
          <div class="land-steps__ui land-steps__ui--chat" aria-hidden="true">
            <span class="land-steps__bubble land-steps__bubble--me">{{ $t('steps.ui_msg_user') }}</span>
            <span class="land-steps__bubble">{{ $t('steps.ui_msg_agent') }}</span>
            <span class="land-steps__input">{{ $t('steps.ui_placeholder') }}<span class="land-steps__send"><Icon name="arrow-up" :size="12" /></span></span>
          </div>
          <h3 class="land-steps__title">{{ $t('steps.interact_title') }}</h3>
          <p class="land-steps__body">{{ $t('steps.interact_body') }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// The beams need the track and the three markers as elements; the section root
// is what useFxPause watches so the light only runs while the steps are on screen.
const fx = useFxTokens();
const fxRoot = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const m1 = ref<HTMLElement | null>(null);
const m2 = ref<HTMLElement | null>(null);
const m3 = ref<HTMLElement | null>(null);
useFxPause(fxRoot);
</script>

<style scoped>
.land-steps {
  position: relative;
  padding: clamp(5rem, 10vw, 8rem) 0;
}
.land-steps__head {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  max-width: 44rem;
  margin-bottom: clamp(3rem, 6vw, 4.5rem);
}
.land-steps__track {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}
@media (min-width: 900px) {
  .land-steps__track {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.5rem;
    align-items: end;
  }
}
.land-steps__line {
  position: absolute;
  left: 1.2rem;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, rgba(245, 161, 107, 0) 0%, rgba(245, 161, 107, 0.55) 30%, rgba(201, 161, 228, 0.5) 70%, rgba(201, 161, 228, 0) 100%);
}
@media (min-width: 900px) {
  .land-steps__line {
    left: 0;
    right: 0;
    top: 1.2rem;
    bottom: auto;
    width: auto;
    height: 1px;
    background: linear-gradient(90deg, rgba(245, 161, 107, 0) 0%, rgba(245, 161, 107, 0.55) 25%, rgba(201, 161, 228, 0.5) 75%, rgba(201, 161, 228, 0) 100%);
  }
}
.land-steps__step {
  position: relative;
  padding: 0 0 0 3.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
@media (min-width: 900px) {
  .land-steps__step {
    padding: 3.5rem 0 0;
  }
  .land-steps__step--mid {
    padding-top: 2.4rem;
  }
}
.land-steps__marker {
  position: absolute;
  left: 0;
  top: 0;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--land-bg);
  border: 1px solid var(--land-border-2);
  box-shadow: 0 0 0 6px var(--land-bg);
}
.land-steps__marker .land-num {
  font-family: var(--land-pixel);
  font-size: 0.85rem;
  color: var(--land-orange);
}
.land-steps__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.land-steps__body {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--land-text-2);
}

/* UI fragments */
.land-steps__ui {
  position: relative;
  border-radius: 1rem;
  background: linear-gradient(180deg, rgba(37, 27, 43, 0.7), rgba(19, 14, 25, 0.95));
  border: 1px solid var(--land-border);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  font-size: 0.8rem;
  min-height: 11rem;
  overflow: hidden;
}
.land-steps__ui--flow {
  min-height: 13rem;
  background:
    radial-gradient(60% 60% at 50% 100%, rgba(245, 161, 107, 0.16) 0%, rgba(245, 161, 107, 0) 70%),
    linear-gradient(180deg, rgba(37, 27, 43, 0.7), rgba(19, 14, 25, 0.95));
}
.land-steps__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.land-steps__label {
  color: var(--land-text-3);
  font-size: 0.74rem;
}
.land-steps__select {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 1.9rem;
  padding: 0 0.6rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.72rem;
}
.land-steps__chips {
  display: inline-flex;
  gap: 0.3rem;
}
.land-steps__chip {
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--land-border);
  color: var(--land-text-2);
  font-family: var(--land-mono);
  font-size: 0.68rem;
}
.land-steps__chip.is-on {
  border-color: rgba(245, 161, 107, 0.6);
  color: var(--land-orange);
  background: rgba(245, 161, 107, 0.1);
}
.land-steps__toggle {
  width: 2.2rem;
  height: 1.25rem;
  border-radius: 999px;
  background: var(--land-orange);
  position: relative;
}
.land-steps__toggle span {
  position: absolute;
  top: 0.15rem;
  right: 0.15rem;
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 999px;
  background: #120c18;
}
.land-steps__submit {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 1.9rem;
  padding: 0 0.8rem;
  border-radius: 999px;
  background: var(--land-text);
  color: #120c18;
  font-weight: 600;
  font-size: 0.74rem;
}
.land-steps__flow {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.land-steps__node {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  align-self: flex-start;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--land-border);
  color: var(--land-text-2);
  font-family: var(--land-mono);
  font-size: 0.7rem;
}
.land-steps__node.is-done {
  color: #9fd9b9;
  border-color: rgba(47, 166, 107, 0.35);
}
.land-steps__node.is-active {
  color: var(--land-text);
  border-color: rgba(245, 161, 107, 0.6);
  background: rgba(245, 161, 107, 0.12);
}
.land-steps__spark {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--land-orange);
  box-shadow: 0 0 8px rgba(245, 161, 107, 0.9);
  animation: land-node-breathe 1.6s ease-in-out infinite;
}
.land-steps__edge {
  width: 1px;
  height: 0.7rem;
  margin-left: 0.95rem;
  background: var(--land-border-2);
}
.land-steps__edge.is-live {
  background: linear-gradient(180deg, rgba(47, 166, 107, 0.6), var(--land-orange));
}
.land-steps__log {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.66rem;
  color: var(--land-text-3);
}
.land-steps__log em {
  font-style: normal;
  color: var(--land-orange);
}
.land-steps__bubble {
  align-self: flex-start;
  max-width: 88%;
  padding: 0.55rem 0.8rem;
  border-radius: 0.9rem 0.9rem 0.9rem 0.25rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--land-border);
  line-height: 1.4;
}
.land-steps__bubble--me {
  align-self: flex-end;
  border-radius: 0.9rem 0.9rem 0.25rem 0.9rem;
  background: var(--land-text);
  color: #120c18;
  border-color: transparent;
}
.land-steps__input {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 2.2rem;
  padding: 0 0.25rem 0 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--land-border-2);
  color: var(--land-text-3);
  font-size: 0.76rem;
}
.land-steps__send {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 999px;
  background: var(--land-orange);
  color: #120c18;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
