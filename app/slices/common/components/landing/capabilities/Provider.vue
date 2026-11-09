<template>
  <section id="platform" class="land-cap">
    <div class="land-wrap">
      <header class="land-cap__head">
        <p class="land-eyebrow" data-reveal>
          <span class="land-num">03</span>{{ $t('capabilities.eyebrow') }}
        </p>
        <h2 class="land-h2" data-reveal style="--reveal-delay: 80ms">{{ $t('capabilities.title') }}</h2>
        <p class="land-lede" data-reveal style="--reveal-delay: 160ms">{{ $t('capabilities.lede') }}</p>
      </header>

      <div class="land-cap__grid">
        <!-- Featured: live conversations -->
        <article class="land-card land-cap__cell land-cap__cell--featured" data-reveal>
          <div class="land-cap__motif land-cap__motif--chat" aria-hidden="true">
            <span class="land-cap__chat-head">
              <span class="land-cap__av land-cap__av--sm">A</span>
              <span>agent-7f2c</span>
              <span class="land-cap__pill is-running land-cap__pill--sm">{{ $t('status.running') }}</span>
              <span class="land-cap__mono">socket.io · jwt</span>
            </span>
            <span class="land-cap__bubble land-cap__bubble--me">{{ $t('capabilities.chat_msg_user') }}</span>
            <span class="land-cap__bubble">
              {{ $t('capabilities.chat_msg_agent') }}
              <span class="land-cap__caret" />
            </span>
            <span class="land-cap__stream">
              <span class="land-cap__stream-dot" /><span class="land-cap__stream-dot" /><span class="land-cap__stream-dot" />
              {{ $t('capabilities.chat_streaming') }}
            </span>
          </div>
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="message-square" :size="18" /></span>
            <h3>{{ $t('capabilities.chat_title') }}</h3>
            <p>{{ $t('capabilities.chat_body') }}</p>
          </div>
        </article>

        <!-- Templates -->
        <article class="land-card land-cap__cell land-cap__cell--wide" data-reveal style="--reveal-delay: 100ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="package" :size="18" /></span>
            <h3>{{ $t('capabilities.templates_title') }}</h3>
            <p>{{ $t('capabilities.templates_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--rows" aria-hidden="true">
            <span class="land-cap__row"><LandingBrandLogo variant="symbol" :size="14" mono :label="null" />ranch/agent-base<em>:1.4</em><b>500m · 1Gi</b></span>
            <span class="land-cap__row"><LandingBrandLogo variant="symbol" :size="14" mono :label="null" />ranch/agent-research<em>:0.9</em><b>1 · 2Gi</b></span>
            <span class="land-cap__row is-dim"><LandingBrandLogo variant="symbol" :size="14" mono :label="null" />custom/image<em>:tag</em><b>…</b></span>
          </div>
        </article>

        <!-- Lifecycle -->
        <article class="land-card land-cap__cell land-cap__cell--wide" data-reveal style="--reveal-delay: 180ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="activity" :size="18" /></span>
            <h3>{{ $t('capabilities.lifecycle_title') }}</h3>
            <p>{{ $t('capabilities.lifecycle_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--pills" aria-hidden="true">
            <span class="land-cap__pill is-pending">{{ $t('status.pending') }}</span>
            <span class="land-cap__pill is-deploying">{{ $t('status.deploying') }}</span>
            <span class="land-cap__pill is-running">{{ $t('status.running') }}</span>
            <span class="land-cap__pill is-stopped">{{ $t('status.stopped') }}</span>
          </div>
        </article>

        <!-- Workflow -->
        <article class="land-card land-cap__cell" data-reveal style="--reveal-delay: 240ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="workflow" :size="18" /></span>
            <h3>{{ $t('capabilities.workflow_title') }}</h3>
            <p>{{ $t('capabilities.workflow_body') }}</p>
          </div>
        </article>

        <!-- Logs -->
        <article class="land-card land-cap__cell" data-reveal style="--reveal-delay: 300ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="scroll-text" :size="18" /></span>
            <h3>{{ $t('capabilities.logs_title') }}</h3>
            <p>{{ $t('capabilities.logs_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--log" aria-hidden="true">
            <span>[bridle] channel open</span>
            <span>[agent] memory restored from s3</span>
            <span class="is-hi">[agent] ready · listening</span>
          </div>
        </article>

        <!-- Multi-agent -->
        <article class="land-card land-cap__cell" data-reveal style="--reveal-delay: 360ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="users" :size="18" /></span>
            <h3>{{ $t('capabilities.fleet_title') }}</h3>
            <p>{{ $t('capabilities.fleet_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--fleet" aria-hidden="true">
            <span class="land-cap__av">A</span>
            <span class="land-cap__av">B</span>
            <span class="land-cap__av">C</span>
            <span class="land-cap__av is-more">+</span>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.land-cap {
  position: relative;
  padding: clamp(5rem, 10vw, 8rem) 0;
  background:
    radial-gradient(60% 40% at 80% 0%, rgba(201, 161, 228, 0.08) 0%, rgba(201, 161, 228, 0) 70%),
    var(--land-bg-2);
  border-top: 1px solid var(--land-border);
  border-bottom: 1px solid var(--land-border);
}
.land-cap__head {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  max-width: 44rem;
  margin-bottom: clamp(3rem, 6vw, 4.5rem);
}
.land-cap__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 700px) {
  .land-cap__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .land-cap__cell--featured {
    grid-column: span 2;
  }
}
@media (min-width: 1024px) {
  .land-cap__grid {
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-auto-rows: minmax(13rem, auto);
  }
  .land-cap__cell {
    grid-column: span 4;
  }
  .land-cap__cell--wide {
    grid-column: span 5;
  }
  .land-cap__cell--featured {
    grid-column: span 7;
    grid-row: span 2;
  }
}
.land-cap__cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
  overflow: hidden;
  transition:
    border-color 0.4s var(--land-ease),
    transform 0.4s var(--land-ease);
}
.land-cap__cell:hover {
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}
.land-cap__cell--featured {
  padding: 1.75rem;
  background:
    radial-gradient(70% 50% at 50% 0%, rgba(245, 161, 107, 0.14) 0%, rgba(245, 161, 107, 0) 70%),
    linear-gradient(180deg, rgba(37, 27, 43, 0.6), rgba(19, 14, 25, 0.9));
}
.land-cap__text {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.land-cap__text h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.land-cap__text p {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: var(--land-text-2);
  max-width: 34rem;
}
.land-cap__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.75rem;
  background: rgba(245, 161, 107, 0.1);
  border: 1px solid rgba(245, 161, 107, 0.25);
  color: var(--land-orange);
  margin-bottom: 0.4rem;
}

/* Motifs */
.land-cap__motif {
  font-size: 0.8rem;
}
.land-cap__motif--chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  justify-content: flex-end;
  min-height: 12rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--land-border);
}
.land-cap__chat-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: auto;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.72rem;
  color: var(--land-text-2);
}
.land-cap__mono {
  margin-left: auto;
  color: var(--land-text-3);
  font-size: 0.66rem;
}
.land-cap__av--sm {
  width: 1.6rem;
  height: 1.6rem;
  font-size: 0.68rem;
  border: 0;
  margin-left: 0;
}
.land-cap__pill--sm {
  padding: 0.15rem 0.5rem;
  font-size: 0.66rem;
}
.land-cap__bubble {
  align-self: flex-start;
  max-width: 78%;
  padding: 0.65rem 0.9rem;
  border-radius: 1rem 1rem 1rem 0.3rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--land-border);
  line-height: 1.45;
  font-size: 0.86rem;
}
.land-cap__bubble--me {
  align-self: flex-end;
  border-radius: 1rem 1rem 0.3rem 1rem;
  background: var(--land-text);
  color: #120c18;
  border-color: transparent;
}
.land-cap__caret {
  display: inline-block;
  width: 2px;
  height: 0.9em;
  margin-left: 2px;
  vertical-align: -0.1em;
  background: var(--land-orange);
  animation: land-node-breathe 1s steps(2) infinite;
}
.land-cap__stream {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--land-mono);
  font-size: 0.68rem;
  color: var(--land-text-3);
  letter-spacing: 0.04em;
}
.land-cap__stream-dot {
  width: 0.3rem;
  height: 0.3rem;
  border-radius: 999px;
  background: var(--land-orange);
  animation: land-node-breathe 1.4s ease-in-out infinite;
}
.land-cap__stream-dot:nth-child(2) {
  animation-delay: 0.2s;
}
.land-cap__stream-dot:nth-child(3) {
  animation-delay: 0.4s;
  margin-right: 0.4rem;
}
.land-cap__motif--rows {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.land-cap__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.72rem;
  color: var(--land-text);
}
.land-cap__row em {
  font-style: normal;
  color: var(--land-lavender);
}
.land-cap__row b {
  margin-left: auto;
  font-weight: 500;
  color: var(--land-text-3);
}
.land-cap__row.is-dim {
  opacity: 0.45;
}
.land-cap__motif--pills {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.land-cap__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--land-border);
  font-size: 0.74rem;
  color: var(--land-text-2);
}
.land-cap__pill::before {
  content: '';
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: currentColor;
}
.land-cap__pill.is-pending::before {
  color: #9a92a3;
}
.land-cap__pill.is-deploying {
  color: var(--land-orange);
  border-color: rgba(245, 161, 107, 0.4);
}
.land-cap__pill.is-running {
  color: #9fd9b9;
  border-color: rgba(47, 166, 107, 0.4);
}
.land-cap__pill.is-stopped::before {
  color: #6e6478;
}
.land-cap__motif--log {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border-radius: 0.6rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.68rem;
  color: var(--land-text-3);
}
.land-cap__motif--log .is-hi {
  color: var(--land-orange);
}
.land-cap__motif--fleet {
  margin-top: auto;
  display: flex;
}
.land-cap__av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 999px;
  background: linear-gradient(135deg, #251b2b, #4a3356);
  border: 2px solid var(--land-bg-2);
  font-size: 0.78rem;
  font-weight: 600;
  margin-left: -0.5rem;
}
.land-cap__av:first-child {
  margin-left: 0;
}
.land-cap__av.is-more {
  background: rgba(245, 161, 107, 0.15);
  color: var(--land-orange);
}
</style>
