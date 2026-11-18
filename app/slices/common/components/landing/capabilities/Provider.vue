<template>
  <section id="platform" ref="rootEl" class="land-cap">
    <div class="land-wrap">
      <header class="land-cap__head">
        <p class="land-eyebrow" data-reveal>
          <span class="land-num">03</span>{{ $t('capabilities.eyebrow') }}
        </p>
        <h2 class="land-h2 land-reveal--blur" data-reveal style="--reveal-delay: 80ms">{{ $t('capabilities.title') }}</h2>
        <p class="land-lede" data-reveal style="--reveal-delay: 160ms">{{ $t('capabilities.lede') }}</p>
      </header>

      <!-- Every card carries a small scripted scene. All six read one clock
           (useSceneClock): it runs while the section is on screen and stops
           under reduced motion, where each scene shows its finished state. -->
      <div ref="gridEl" class="land-cap__grid">
        <!-- Featured: live conversations. A question, a pause to think, a reply
             that arrives word by word, then where the answer came from. -->
        <article class="land-card land-cap__cell land-cap__cell--featured relative land-fx-once" data-spot data-reveal>
          <span class="land-dots land-cap__dots" aria-hidden="true" />
          <div class="land-cap__motif land-cap__motif--chat" aria-hidden="true">
            <span class="land-cap__chat-head">
              <span class="land-cap__av land-cap__av--sm">A</span>
              <span>agent-7f2c</span>
              <span class="land-cap__pill is-running land-cap__pill--sm">{{ $t('status.running') }}</span>
              <span class="land-cap__mono">socket.io · jwt</span>
            </span>
            <div class="land-cap__feed" :class="{ 'is-out': chatOut }">
              <span class="land-cap__bubble land-cap__bubble--me" :class="{ 'is-in': chatUser }">{{ exchange.user }}</span>
              <span v-if="chatThinking" class="land-cap__think">
                <span class="land-cap__stream-dot" /><span class="land-cap__stream-dot" /><span class="land-cap__stream-dot" />
                {{ $t('capabilities.chat_thinking') }}
              </span>
              <span v-if="chatWords > 0" class="land-cap__bubble land-cap__bubble--agent">
                <span v-for="(word, i) in exchange.agent.slice(0, chatWords)" :key="i" class="land-cap__word">{{ word }}{{ ' ' }}</span>
                <span v-if="chatStreaming" class="land-cap__caret" />
              </span>
              <span v-if="chatSource" class="land-cap__sources">
                <Icon name="link-2" :size="11" />
                {{ $t('capabilities.chat_sources') }}
                <b>{{ exchange.source }}</b>
              </span>
            </div>
            <span class="land-cap__stream" :class="{ 'is-live': chatStreaming }">
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

        <!-- Templates: the selection walks the list. -->
        <article class="land-card land-cap__cell land-cap__cell--wide relative land-fx-once" data-spot data-reveal style="--reveal-delay: 100ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="package" :size="18" /></span>
            <h3>{{ $t('capabilities.templates_title') }}</h3>
            <p>{{ $t('capabilities.templates_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--rows" aria-hidden="true" :style="{ '--row': templateRow }">
            <span class="land-cap__pick" />
            <span
              v-for="(row, i) in templates"
              :key="row.name"
              class="land-cap__row"
              :class="{ 'is-on': templateRow === i, 'is-dim': row.dim && templateRow !== i }"
            >
              <LandingBrandLogo variant="symbol" :size="14" mono :label="null" />{{ row.name }}<em>{{ row.tag }}</em><b>{{ row.resources }}</b>
            </span>
          </div>
        </article>

        <!-- Lifecycle: the phase advances the way an agent's does. -->
        <article class="land-card land-cap__cell land-cap__cell--wide relative land-fx-once" data-spot data-reveal style="--reveal-delay: 180ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="activity" :size="18" /></span>
            <h3>{{ $t('capabilities.lifecycle_title') }}</h3>
            <p>{{ $t('capabilities.lifecycle_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--pills" aria-hidden="true">
            <span
              v-for="(phase, i) in phases"
              :key="phase"
              class="land-cap__pill"
              :class="[`is-${phase}`, { 'is-on': lifePhase === i, 'is-off': lifePhase >= 0 && lifePhase !== i }]"
            >{{ $t(`status.${phase}`) }}</span>
          </div>
        </article>

        <!-- Workflow: the four steps of a deployment complete in order. -->
        <article class="land-card land-cap__cell relative land-fx-once" data-spot data-reveal style="--reveal-delay: 240ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="workflow" :size="18" /></span>
            <h3>{{ $t('capabilities.workflow_title') }}</h3>
            <p>{{ $t('capabilities.workflow_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--dag" aria-hidden="true">
            <span
              v-for="(node, i) in dag"
              :key="node"
              class="land-cap__node"
              :class="{ 'is-hot': dagStep === i, 'is-done': dagStep > i }"
            >
              <span class="land-cap__node-dot"><Icon name="check" :size="10" /></span>
              {{ node }}
            </span>
          </div>
        </article>

        <!-- Logs: the tail of a pod log, a new line every second or so. -->
        <article class="land-card land-cap__cell relative land-fx-once" data-spot data-reveal style="--reveal-delay: 300ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="scroll-text" :size="18" /></span>
            <h3>{{ $t('capabilities.logs_title') }}</h3>
            <p>{{ $t('capabilities.logs_body') }}</p>
          </div>
          <TransitionGroup name="land-log" tag="div" class="land-cap__motif land-cap__motif--log" aria-hidden="true">
            <span v-for="line in logTail" :key="line.id" :class="{ 'is-hi': line.last }">{{ line.text }}</span>
          </TransitionGroup>
        </article>

        <!-- Multi-agent: one agent at a time restarts and comes back. -->
        <article class="land-card land-cap__cell relative land-fx-once" data-spot data-reveal style="--reveal-delay: 360ms">
          <div class="land-cap__text">
            <span class="land-cap__icon"><Icon name="users" :size="18" /></span>
            <h3>{{ $t('capabilities.fleet_title') }}</h3>
            <p>{{ $t('capabilities.fleet_body') }}</p>
          </div>
          <div class="land-cap__motif land-cap__motif--fleet" aria-hidden="true">
            <span v-for="(name, i) in fleet" :key="name" class="land-cap__av" :style="{ '--i': i }">
              {{ name }}<span class="land-cap__av-state" />
            </span>
            <span class="land-cap__av is-more">+</span>
          </div>
        </article>
      </div>

      <p class="land-cap__note" data-reveal>
        <Icon name="info" :size="14" />
        {{ $t('capabilities.demo_note') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
const { t: translate } = useI18n();

// One lamp over the whole bento: the pointer position reaches every card as
// --mx / --my and the cards' ::before / ::after paint the shared light (see
// useGridSpotlight). Off under reduced motion and on devices without hover.
const fx = useFxTokens();
const rootEl = ref<HTMLElement | null>(null);
const gridEl = ref<HTMLElement | null>(null);
useGridSpotlight(gridEl, fx);
useFxPause(rootEl);

// The scenes' clock: one tick is 90 ms. Every value below is derived from
// it, so nothing here owns a timer and a scene resumes where it paused.
const { t: tick, still } = useSceneClock(rootEl);

// ── Chat ──────────────────────────────────────────────────────────────
// Two exchanges alternate. Positions on an exchange's own timeline, in ticks:
const USER_AT = 3;
const THINK_AT = 12;
const STREAM_AT = 24;
const WORD = 2; // ticks per word of the reply
const SOURCE_AFTER = 5; // after the last word
const HOLD = 38; // the finished exchange stays readable
const FADE = 4; // then clears before the next one

const exchanges = computed(() => [
  {
    user: translate('capabilities.chat_msg_user'),
    agent: translate('capabilities.chat_msg_agent').split(' '),
    source: translate('capabilities.chat_source_events'),
  },
  {
    user: translate('capabilities.chat_msg_user2'),
    agent: translate('capabilities.chat_msg_agent2').split(' '),
    source: translate('capabilities.chat_source_workflow'),
  },
]);
const exchangeLength = (words: number) => STREAM_AT + words * WORD + SOURCE_AFTER + HOLD + FADE;

const chatAt = computed(() => {
  const lengths = exchanges.value.map((e) => exchangeLength(e.agent.length));
  // Reduced motion: the first exchange, complete.
  if (still.value) return { index: 0, at: lengths[0]! - FADE - 1, length: lengths[0]! };
  let at = tick.value % (lengths[0]! + lengths[1]!);
  const index = at >= lengths[0]! ? 1 : 0;
  if (index === 1) at -= lengths[0]!;
  return { index, at, length: lengths[index]! };
});
const exchange = computed(() => exchanges.value[chatAt.value.index]!);
const chatUser = computed(() => chatAt.value.at >= USER_AT);
const chatThinking = computed(() => chatAt.value.at >= THINK_AT && chatAt.value.at < STREAM_AT);
const chatWords = computed(() => {
  const { at } = chatAt.value;
  if (at < STREAM_AT) return 0;
  return Math.min(exchange.value.agent.length, Math.floor((at - STREAM_AT) / WORD) + 1);
});
const chatStreaming = computed(() => chatWords.value > 0 && chatWords.value < exchange.value.agent.length);
const chatSource = computed(() => chatAt.value.at >= STREAM_AT + exchange.value.agent.length * WORD + SOURCE_AFTER);
const chatOut = computed(() => chatAt.value.at >= chatAt.value.length - FADE);

// ── Templates ─────────────────────────────────────────────────────────
const templates = [
  { name: 'ranch/agent-base', tag: ':1.4', resources: '500m · 1Gi', dim: false },
  { name: 'ranch/agent-research', tag: ':0.9', resources: '1 · 2Gi', dim: false },
  { name: 'custom/image', tag: ':tag', resources: '…', dim: true },
];
const templateRow = computed(() => (still.value ? 0 : Math.floor(tick.value / 28) % templates.length));

// ── Lifecycle ─────────────────────────────────────────────────────────
// How long each phase holds, in ticks. -1 (reduced motion) lights them all.
const phases = ['pending', 'deploying', 'running', 'stopped'] as const;
const PHASE_TICKS = [12, 24, 46, 16];
const PHASE_TOTAL = PHASE_TICKS.reduce((sum, n) => sum + n, 0);
const lifePhase = computed(() => {
  if (still.value) return -1;
  let at = tick.value % PHASE_TOTAL;
  for (let i = 0; i < PHASE_TICKS.length; i += 1) {
    if (at < PHASE_TICKS[i]!) return i;
    at -= PHASE_TICKS[i]!;
  }
  return 0;
});

// ── Workflow ──────────────────────────────────────────────────────────
// Steps 0–3 light one node each, 4–6 hold the finished graph, 7 clears it.
const dag = ['submit', 'schedule', 'pull', 'start'];
const dagStep = computed(() => {
  if (still.value) return dag.length;
  const step = Math.floor(tick.value / 11) % 8;
  return step === 7 ? -1 : step;
});

// ── Logs ──────────────────────────────────────────────────────────────
const LOG = [
  '[bridle] channel open',
  '[agent] memory restored from s3',
  '[agent] ready · listening',
  '[chat] message received',
  '[agent] tool call started',
  '[agent] reply streamed',
  '[bridle] heartbeat ok',
  '[agent] idle · listening',
];
const LOG_ROWS = 3;
const logStart = computed(() => (still.value ? 0 : Math.floor(tick.value / 15)));
const logTail = computed(() =>
  Array.from({ length: LOG_ROWS }, (_, k) => {
    const id = logStart.value + k;
    return { id, text: LOG[id % LOG.length]!, last: k === LOG_ROWS - 1 };
  }),
);

// ── Fleet ─────────────────────────────────────────────────────────────
const fleet = ['A', 'B', 'C'];
</script>

<style scoped>
.land-cap {
  position: relative;
  padding: clamp(5rem, 10vw, 8rem) 0;
  background:
    radial-gradient(60% 40% at 80% 0%, rgba(201, 161, 228, 0.08) 0%, rgba(201, 161, 228, 0) 70%),
    var(--land-bg-2);
  border-block: 1px solid transparent;
  border-image: var(--land-horizon) 1;
}
/* The empty air above the chat is the lamp the conversation sits under. */
.land-cap__dots {
  left: 8%;
  right: 8%;
  top: -34%;
  height: 78%;
  --dots-opacity: 0.42;
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
  min-height: 12rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--land-border);
}
/* The conversation itself. It has a height of its own (the reply growing
   word by word never moves the card) and is anchored to the bottom, the way
   a chat is: anything too tall slides out under the header. */
.land-cap__feed {
  flex: 1 1 0;
  min-height: 11.5rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.7rem;
  -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, #000 1.75rem);
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, #000 1.75rem);
  transition: opacity 0.3s var(--land-ease);
}
.land-cap__feed.is-out {
  opacity: 0;
}
@media (max-width: 699px) {
  .land-cap__feed {
    min-height: 15rem;
  }
}
.land-cap__chat-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.72rem;
  color: var(--land-text-2);
}
.land-cap__chat-head > * {
  white-space: nowrap;
}
.land-cap__mono {
  margin-left: auto;
  color: var(--land-text-3);
  font-size: 0.66rem;
}
@media (max-width: 420px) {
  .land-cap__mono {
    display: none;
  }
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
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.35s var(--land-ease),
    transform 0.35s var(--land-ease);
}
.land-cap__bubble--me.is-in {
  opacity: 1;
  transform: none;
}
.land-cap__bubble--agent,
.land-cap__think,
.land-cap__sources {
  animation: land-cap-pop 0.35s var(--land-ease);
}
.land-cap__word {
  animation: land-cap-word 0.3s ease-out;
}
.land-cap__think {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.5rem 0.8rem;
  border-radius: 1rem 1rem 1rem 0.3rem;
  border: 1px dashed var(--land-border-2);
  font-family: var(--land-mono);
  font-size: 0.68rem;
  color: var(--land-text-3);
}
.land-cap__sources {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(201, 161, 228, 0.3);
  background: rgba(201, 161, 228, 0.08);
  font-family: var(--land-mono);
  font-size: 0.66rem;
  color: var(--land-text-3);
}
.land-cap__sources b {
  font-weight: 500;
  color: var(--land-lavender);
}
@keyframes land-cap-pop {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@keyframes land-cap-word {
  from {
    opacity: 0;
    filter: blur(3px);
  }
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
  opacity: 0.35;
  transition: opacity 0.4s var(--land-ease);
}
.land-cap__stream.is-live {
  opacity: 1;
}
.land-cap__stream:not(.is-live) .land-cap__stream-dot {
  animation: none;
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
  --row-h: 2.15rem;
  --row-gap: 0.35rem;
  position: relative;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--row-gap);
}
/* The selection: one frame that slides to the row being picked. */
.land-cap__pick {
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--row-h);
  border-radius: 0.6rem;
  border: 1px solid rgba(245, 161, 107, 0.55);
  background: rgba(245, 161, 107, 0.08);
  box-shadow: 0 0 22px -6px rgba(245, 161, 107, 0.55);
  transform: translateY(calc(var(--row, 0) * (var(--row-h) + var(--row-gap))));
  transition: transform 0.6s var(--land-ease);
  pointer-events: none;
}
.land-cap__row {
  position: relative;
  box-sizing: border-box;
  height: var(--row-h);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.7rem;
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
.land-cap__row {
  transition: opacity 0.5s var(--land-ease);
}
.land-cap__row b {
  transition: color 0.5s var(--land-ease);
}
.land-cap__row.is-on b {
  color: var(--land-orange);
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
/* The phase an agent is in right now; the others wait their turn. */
.land-cap__motif--pills .land-cap__pill {
  transition:
    opacity 0.5s var(--land-ease),
    transform 0.5s var(--land-ease),
    box-shadow 0.5s var(--land-ease),
    background-color 0.5s var(--land-ease);
}
.land-cap__motif--pills .land-cap__pill.is-off {
  opacity: 0.38;
}
.land-cap__motif--pills .land-cap__pill.is-on {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 22px -10px currentColor;
}
.land-cap__motif--pills .land-cap__pill.is-on.is-deploying::before,
.land-cap__motif--pills .land-cap__pill.is-on.is-running::before {
  animation: land-node-breathe 1.2s ease-in-out infinite;
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
  position: relative;
  overflow: hidden;
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
.land-cap__motif--log span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.6s var(--land-ease);
}
.land-cap__motif--log .is-hi {
  color: var(--land-orange);
}
/* A new line pushes the tail up; the oldest leaves through the top. */
.land-log-move,
.land-log-enter-active,
.land-log-leave-active {
  transition:
    transform 0.5s var(--land-ease),
    opacity 0.5s var(--land-ease),
    color 0.6s var(--land-ease);
}
.land-log-enter-from {
  opacity: 0;
  transform: translateY(100%);
}
.land-log-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
.land-log-leave-active {
  position: absolute;
  left: 0.8rem;
  right: 0.8rem;
}

/* Workflow graph: four steps on one wire. */
.land-cap__motif--dag {
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.land-cap__node {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--land-mono);
  font-size: 0.64rem;
  color: var(--land-text-3);
  transition: color 0.5s var(--land-ease);
}
.land-cap__node::before,
.land-cap__node::after {
  content: '';
  position: absolute;
  top: calc(0.7rem - 0.5px);
  right: 50%;
  width: 100%;
  height: 1px;
}
.land-cap__node::before {
  background: var(--land-border-2);
}
.land-cap__node::after {
  background: linear-gradient(90deg, var(--land-lavender), var(--land-orange));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.7s var(--land-ease);
}
.land-cap__node:first-child::before,
.land-cap__node:first-child::after {
  display: none;
}
.land-cap__node.is-hot::after,
.land-cap__node.is-done::after {
  transform: scaleX(1);
}
.land-cap__node-dot {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  border: 1px solid var(--land-border-2);
  background: var(--land-bg-2);
  color: transparent;
  transition:
    border-color 0.5s var(--land-ease),
    background-color 0.5s var(--land-ease),
    color 0.5s var(--land-ease),
    box-shadow 0.5s var(--land-ease),
    transform 0.5s var(--land-ease);
}
.land-cap__node.is-hot {
  color: var(--land-text);
}
.land-cap__node.is-hot .land-cap__node-dot {
  border-color: var(--land-orange);
  box-shadow: 0 0 16px rgba(245, 161, 107, 0.8);
  transform: scale(1.15);
}
.land-cap__node.is-done {
  color: var(--land-text-2);
}
.land-cap__node.is-done .land-cap__node-dot {
  border-color: rgba(201, 161, 228, 0.6);
  background: rgba(201, 161, 228, 0.16);
  color: var(--land-lavender);
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
/* Each agent's state light. One at a time drops out, redeploys and comes
   back; the base colour is "running", which is also the still frame. */
.land-cap__motif--fleet .land-cap__av {
  position: relative;
}
.land-cap__av-state {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  border: 2px solid var(--land-bg-2);
  background: #4fc98a;
  animation: land-cap-fleet 9s linear infinite;
  animation-delay: calc(var(--i) * 3s);
}
@keyframes land-cap-fleet {
  0%,
  3% {
    background: #4fc98a;
    box-shadow: 0 0 0 0 rgba(245, 161, 107, 0);
  }
  6%,
  10% {
    background: #7e7488;
  }
  14% {
    background: var(--land-orange);
    box-shadow: 0 0 0 0 rgba(245, 161, 107, 0.7);
  }
  24% {
    background: var(--land-orange);
    box-shadow: 0 0 0 7px rgba(245, 161, 107, 0);
  }
  28%,
  100% {
    background: #4fc98a;
    box-shadow: 0 0 0 0 rgba(245, 161, 107, 0);
  }
}
.land-cap__note {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1.25rem 0 0;
  font-size: 0.82rem;
  color: var(--land-text-3);
}
.land-cap__icon {
  transition:
    background-color 0.4s var(--land-ease),
    transform 0.4s var(--land-ease);
}
.land-cap__cell:hover .land-cap__icon {
  background: rgba(245, 161, 107, 0.2);
  transform: scale(1.06);
}
.land-cap__av.is-more {
  background: rgba(245, 161, 107, 0.15);
  color: var(--land-orange);
}

/* Shared pointer light (useGridSpotlight): ::before is the border, ::after the
   inner glow, both radial gradients at the pointer with a radius wider than
   a card so the light runs across the neighbours as one source. */
.land-cap__grid {
  --spot-on: 0;
}
.land-cap__cell {
  --mx: -9999px;
  --my: -9999px;
}
.land-cap__cell::before,
.land-cap__cell::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: var(--spot-on, 0);
  transition: opacity 0.35s var(--land-ease);
}
.land-cap__cell::before {
  padding: 1px;
  background: radial-gradient(calc(var(--land-fx-spot-size, 320) * 1.6px) circle at var(--mx) var(--my), var(--land-fx-from), transparent 60%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  z-index: 2;
}
.land-cap__cell::after {
  background: radial-gradient(calc(var(--land-fx-spot-size, 320) * 2px) circle at var(--mx) var(--my), var(--land-fx-spot-color), transparent 55%);
  z-index: 0;
}
.land-cap__cell > * {
  position: relative;
  z-index: 1;
}
/* The lamp is a layer, not a row: it stays out of the flex flow and under
   the content that the rule above lifts. */
.land-cap__cell > .land-cap__dots {
  position: absolute;
  z-index: 0;
}
@media (prefers-reduced-motion: reduce), (hover: none) {
  .land-cap__cell::before,
  .land-cap__cell::after {
    display: none;
  }
}
</style>
