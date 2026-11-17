<template>
  <section id="infrastructure" ref="rootEl" class="land-rt" :class="{ 'is-flat': flat }">
    <div class="land-wrap">
      <header class="land-rt__head">
        <p class="land-eyebrow" data-reveal>
          <span class="land-num">04</span>{{ $t('runtime.eyebrow') }}
        </p>
        <h2 class="land-h2 land-reveal--blur" data-reveal style="--reveal-delay: 80ms">{{ $t('runtime.title') }}</h2>
        <p class="land-lede" data-reveal style="--reveal-delay: 160ms">{{ $t('runtime.lede') }}</p>
      </header>
    </div>

    <!-- One window, four states. On wide screens the scene is pinned while the
         page scrolls through the track: the scroll position picks the station
         and how far its screen has played, and a light travels round the
         window's edge, turning from lavender to copper on the way. Narrow
         screens get the same four stations as a plain list, each with its
         finished screen under it. -->
    <div ref="trackEl" class="land-rt__track">
      <div ref="pinEl" class="land-rt__pin">
        <div class="land-wrap">
          <div class="land-rt__scene">
            <span class="land-dots land-rt__dots" aria-hidden="true" />
            <span class="land-rt__bloom" aria-hidden="true" />

            <ol class="land-rt__stations">
              <li
                v-for="(station, i) in stations"
                :key="station.key"
                class="land-rt__station"
                :class="{ 'is-active': step === i, 'is-done': step > i }"
                :style="{ '--sub': localOf(i) }"
              >
                <div class="land-rt__text">
                  <span class="land-rt__port" aria-hidden="true"><span /></span>
                  <h3 class="land-rt__title">
                    <component
                      :is="flat ? 'span' : 'button'"
                      :type="flat ? undefined : 'button'"
                      class="land-rt__jump"
                      :aria-current="!flat && step === i ? 'step' : undefined"
                      @click="goTo(i)"
                    >
                      <span class="land-rt__index" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
                      {{ $t(`runtime.${station.key}_title`) }}
                    </component>
                  </h3>
                  <div class="land-rt__more">
                    <div>
                      <p class="land-rt__body">{{ $t(`runtime.${station.key}_body`) }}</p>
                      <ul class="land-rt__chips" aria-label="">
                        <li v-for="chip in station.chips" :key="chip">{{ chip }}</li>
                      </ul>
                    </div>
                  </div>
                  <span class="land-rt__meter" aria-hidden="true"><span /></span>
                </div>

                <div class="land-rt__screen" aria-hidden="true">
                  <div class="land-rt__bar">
                    <span
                      v-for="(tab, k) in stations"
                      :key="tab.key"
                      class="land-rt__tab"
                      :class="{ 'is-on': k === i }"
                    >
                      <Icon :name="tab.icon" :size="13" />{{ $t(`runtime.tab_${tab.key}`) }}
                    </span>
                    <span class="land-rt__demo">{{ $t('stage.demo') }}</span>
                  </div>

                  <!-- 01 · the agent record fills in, then Deploy is pressed -->
                  <div v-if="station.key === 'config'" class="land-rt__view">
                    <p class="land-rt__view-title">{{ $t('runtime.ui_record') }}<code>agent-7f2c</code></p>
                    <dl class="land-rt__record">
                      <div v-for="(field, k) in record" :key="field.label" :class="{ 'is-in': k < recordRows }">
                        <dt>{{ field.label }}</dt>
                        <dd>{{ field.value }}</dd>
                      </div>
                    </dl>
                    <span class="land-rt__deploy" :class="{ 'is-pressed': localOf(i) >= 1 }">
                      {{ $t('steps.ui_deploy') }}
                      <Icon name="arrow-right" :size="14" />
                    </span>
                  </div>

                  <!-- 02 · the workflow's steps complete in order -->
                  <div v-else-if="station.key === 'argo'" class="land-rt__view">
                    <p class="land-rt__view-title">
                      Workflow<code>agent-7f2c-deploy</code>
                      <span class="land-rt__phase" :class="`is-${argoPhase.tone}`">{{ argoPhase.label }}</span>
                    </p>
                    <ol class="land-rt__flow">
                      <li
                        v-for="(flowStep, k) in flow"
                        :key="flowStep"
                        :class="{ 'is-done': k < argoDone, 'is-run': k === argoDone }"
                      >
                        <span class="land-rt__flow-dot">
                          <Icon v-if="k < argoDone" name="check" :size="11" />
                          <span v-else-if="k === argoDone" class="land-rt__spin" />
                        </span>
                        {{ $t(flowStep) }}
                      </li>
                    </ol>
                  </div>

                  <!-- 03 · the pod is scheduled, pulls the image and starts -->
                  <div v-else-if="station.key === 'k8s'" class="land-rt__view">
                    <p class="land-rt__view-title">
                      Pod<code>agent-7f2c</code>
                      <span class="land-rt__phase" :class="`is-${podPhase.tone}`">{{ podPhase.label }}</span>
                    </p>
                    <div class="land-rt__requests">
                      <span><i>requests.cpu</i><b>500m</b></span>
                      <span><i>requests.memory</i><b>1Gi</b></span>
                    </div>
                    <div class="land-rt__log">
                      <span v-for="(line, k) in podLog" :key="line" :class="{ 'is-in': k < podLines, 'is-hi': k === podLines - 1 }">{{ line }}</span>
                    </div>
                  </div>

                  <!-- 04 · the agent joins the hub and answers its first message -->
                  <div v-else class="land-rt__view land-rt__view--chat">
                    <span class="land-rt__chat-head">
                      <span class="land-rt__av">A</span>
                      <span>agent-7f2c</span>
                      <span class="land-rt__phase is-ok">{{ $t('status.running') }}</span>
                      <span class="land-rt__mono">socket.io · jwt</span>
                    </span>
                    <span class="land-rt__sys" :class="{ 'is-in': localOf(i) > 0.02 }">[bridle] channel open</span>
                    <span class="land-rt__bubble land-rt__bubble--me" :class="{ 'is-in': localOf(i) >= 0.18 }">{{ $t('runtime.chat_user') }}</span>
                    <span class="land-rt__bubble" :class="{ 'is-in': chatWords > 0 }">
                      <span v-for="(word, k) in reply" :key="k" class="land-rt__word" :class="{ 'is-in': k < chatWords }">{{ word }}{{ ' ' }}</span>
                    </span>
                  </div>
                </div>
              </li>
            </ol>

            <span class="land-rt__ring" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>

    <div class="land-wrap">
      <p class="land-rt__note" data-reveal>
        <Icon name="shield-check" :size="14" />
        {{ $t('runtime.note') }}
      </p>
      <p class="land-rt__note land-rt__note--demo" data-reveal>
        <Icon name="info" :size="14" />
        {{ $t(flat ? 'runtime.scene_note_flat' : 'runtime.scene_note') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
const { t: translate } = useI18n();

const stations = [
  { key: 'config', icon: 'sliders-horizontal', chips: ['image:tag', 'cpu / memory', 'isPublic'] },
  { key: 'argo', icon: 'workflow', chips: ['Workflow', 'Pending → Running', 'Succeeded'] },
  { key: 'k8s', icon: 'boxes', chips: ['k3s', 'Pod', 'ContainerCreating'] },
  { key: 'agent', icon: 'message-square', chips: ['Bridle hub', 'socket.io', 'JWT'] },
];
const COUNT = stations.length;

const rootEl = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const pinEl = ref<HTMLElement | null>(null);
useFxPause(rootEl);

// `flat` is the unpinned layout: narrow screens, and the moment before mount.
// `step` is the station the scroll position is on; `sub` is how far through
// that station's share of the track it is, in fortieths so a scroll frame
// re-renders the scene only when something visible changes.
const flat = ref(true);
const step = ref(0);
const sub = ref(0);

// A screen finishes playing at 72 % of its share and holds for the rest, so
// the finished state can be read before the next one takes over.
const PLAY = 0.72;
function localOf(i: number) {
  if (flat.value || step.value > i) return 1;
  if (step.value < i) return 0;
  return Math.min(1, sub.value / PLAY);
}

// ── Screens ───────────────────────────────────────────────────────────
const record = computed(() => [
  { label: translate('steps.ui_template'), value: 'ranch/agent-base' },
  { label: translate('runtime.ui_tag'), value: ':1.4' },
  { label: 'CPU', value: '500m' },
  { label: translate('stage.memory'), value: '1Gi' },
  { label: translate('runtime.ui_visibility'), value: translate('runtime.ui_private') },
]);
const recordRows = computed(() => 1 + Math.round(localOf(0) * (record.value.length - 1)));

const flow = ['stage.flow_submit', 'stage.flow_schedule', 'stage.flow_pull', 'stage.flow_start'];
const argoDone = computed(() => Math.min(flow.length, Math.floor(localOf(1) * (flow.length + 0.999))));
// Phase names are the ones Argo and Kubernetes report, so they stay as they
// are in every language; `tone` picks the pill's colour.
const argoPhase = computed(() => {
  if (argoDone.value >= flow.length) return { label: 'Succeeded', tone: 'ok' };
  return localOf(1) < 0.06 ? { label: 'Pending', tone: 'idle' } : { label: 'Running', tone: 'busy' };
});

const podLog = [
  '[k3s] pod scheduled',
  '[kubelet] pulling ranch/agent-base:1.4',
  '[kubelet] container started',
  '[agent] memory restored from s3',
  '[agent] ready · listening',
];
const podLines = computed(() => Math.round(localOf(2) * podLog.length));
const podPhase = computed(() => {
  const at = localOf(2);
  if (at < 0.3) return { label: 'Pending', tone: 'idle' };
  return at < 0.62 ? { label: 'ContainerCreating', tone: 'busy' } : { label: 'Running', tone: 'ok' };
});

const reply = computed(() => translate('runtime.chat_agent').split(' '));
const chatWords = computed(() => {
  const at = localOf(3);
  if (at < 0.34) return 0;
  return Math.min(reply.value.length, Math.ceil(((at - 0.34) / 0.6) * reply.value.length));
});

// ── Scroll ────────────────────────────────────────────────────────────
let wide: MediaQueryList | null = null;
let frame = 0;
let stickyTop = 0;

function geometry() {
  const track = trackEl.value;
  const pin = pinEl.value;
  if (!track || !pin) return null;
  const rect = track.getBoundingClientRect();
  return { rect, travel: rect.height - pin.offsetHeight };
}

function measure() {
  frame = 0;
  if (flat.value) return;
  const g = geometry();
  if (!g) return;
  const raw = g.travel > 0 ? Math.min(1, Math.max(0, (stickyTop - g.rect.top) / g.travel)) : 0;
  trackEl.value!.style.setProperty('--p', raw.toFixed(4));
  const at = raw * COUNT;
  const index = Math.min(COUNT - 1, Math.floor(at));
  step.value = index;
  sub.value = Math.round(Math.min(1, at - index) * 40) / 40;
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(measure);
}

function layout() {
  flat.value = !wide?.matches;
  // The pin's `top` is read after the class has reached the DOM.
  nextTick(() => {
    stickyTop = pinEl.value ? Number.parseFloat(getComputedStyle(pinEl.value).top) || 0 : 0;
    if (flat.value) trackEl.value?.style.removeProperty('--p');
    schedule();
  });
}

// A station's title is a button on wide screens: it scrolls to the middle of
// that station's share of the track.
function goTo(i: number) {
  if (flat.value) return;
  const g = geometry();
  if (!g) return;
  const top = window.scrollY + g.rect.top - stickyTop + (g.travel * (i + 0.5)) / COUNT;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top, behavior: calm ? 'auto' : 'smooth' });
}

onMounted(() => {
  wide = window.matchMedia('(min-width: 1024px)');
  wide.addEventListener('change', layout);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', layout, { passive: true });
  layout();
});

onBeforeUnmount(() => {
  wide?.removeEventListener('change', layout);
  window.removeEventListener('scroll', schedule);
  window.removeEventListener('resize', layout);
  if (frame) cancelAnimationFrame(frame);
});
</script>

<style scoped>
.land-rt {
  /* The pinned scene's height, how much scroll one station gets, and where
     the scene sticks under the floating navigation. */
  --rt-h: clamp(27rem, calc(100svh - 10rem), 31rem);
  --rt-step: 58vh;
  --rt-top: max(6.5rem, calc((100svh - var(--rt-h)) / 2 + 1.5rem));
  --rt-gap: 3rem;
  --rt-window: calc((100% - var(--rt-gap)) * 7 / 12);
  position: relative;
  padding: clamp(5rem, 10vw, 8rem) 0;
}
.land-rt__head {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  max-width: 44rem;
  margin-bottom: clamp(2.5rem, 5vw, 3.5rem);
}

/* ── Pinned layout (wide screens) ──────────────────────────────────── */
.land-rt:not(.is-flat) .land-rt__track {
  height: calc(var(--rt-h) + 4 * var(--rt-step));
}
.land-rt:not(.is-flat) .land-rt__pin {
  position: sticky;
  top: var(--rt-top);
  height: var(--rt-h);
}
.land-rt__pin > .land-wrap,
.land-rt__scene {
  height: 100%;
}
.land-rt__scene {
  position: relative;
}
.land-rt__stations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.land-rt:not(.is-flat) .land-rt__stations {
  width: calc((100% - var(--rt-gap)) * 5 / 12);
  height: 100%;
  justify-content: center;
  gap: 0.4rem;
}

/* Station text */
.land-rt__text {
  position: relative;
  padding: 0.95rem 1.1rem 0.95rem 3rem;
  border-radius: 1rem;
  border: 1px solid transparent;
  transition:
    background-color 0.5s var(--land-ease),
    border-color 0.5s var(--land-ease);
}
.land-rt.is-flat .land-rt__text,
.land-rt__station.is-active .land-rt__text {
  background: rgba(19, 14, 25, 0.7);
  border-color: var(--land-border);
  box-shadow: var(--land-rim);
}
.land-rt__port {
  position: absolute;
  left: 1rem;
  top: 1.05rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  border: 1px solid var(--land-border-2);
  background: var(--land-bg);
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
.land-rt__station.is-active .land-rt__port {
  border-color: rgba(245, 161, 107, 0.7);
}
.land-rt__station.is-active .land-rt__port span {
  background: var(--land-orange);
  box-shadow: 0 0 14px rgba(245, 161, 107, 0.9);
}
.land-rt__station.is-done .land-rt__port span,
.land-rt.is-flat .land-rt__port span {
  background: var(--land-lavender);
}
.land-rt__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
}
.land-rt__jump {
  display: inline-flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--land-text-2);
  text-align: left;
  transition: color 0.5s var(--land-ease);
}
button.land-rt__jump {
  cursor: pointer;
}
button.land-rt__jump:hover {
  color: var(--land-text);
}
button.land-rt__jump:focus-visible {
  outline: 2px solid var(--land-orange);
  outline-offset: 4px;
  border-radius: 0.3rem;
}
.land-rt.is-flat .land-rt__jump,
.land-rt__station.is-active .land-rt__jump {
  color: var(--land-text);
}
.land-rt__index {
  font-family: var(--land-pixel);
  font-size: 0.85rem;
  font-weight: 400;
  color: var(--land-text-3);
}
.land-rt__station.is-active .land-rt__index {
  color: var(--land-orange);
}
/* Body and chips open for the station in view; the rest keep their titles. */
.land-rt__more {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.55s var(--land-ease);
}
.land-rt__more > div {
  min-height: 0;
  overflow: hidden;
}
.land-rt.is-flat .land-rt__more,
.land-rt__station.is-active .land-rt__more {
  grid-template-rows: 1fr;
}
.land-rt__body {
  margin: 0.55rem 0 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--land-text-2);
}
.land-rt__chips {
  list-style: none;
  margin: 0;
  padding: 0.75rem 0 0.1rem;
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
/* How far the screen of the station in view has played. */
.land-rt__meter {
  position: absolute;
  left: 3rem;
  right: 1.1rem;
  bottom: 0;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.4s var(--land-ease);
}
.land-rt__meter span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--land-lavender), var(--land-orange));
  transform: scaleX(var(--sub, 0));
  transform-origin: left;
  transition: transform 0.25s linear;
}
.land-rt:not(.is-flat) .land-rt__station.is-active .land-rt__meter {
  opacity: 1;
}

/* ── The window ────────────────────────────────────────────────────── */
.land-rt__screen {
  display: flex;
  flex-direction: column;
  min-height: 17rem;
  margin-top: 0.75rem;
  border-radius: 1.25rem;
  border: 1px solid var(--land-border-2);
  background: linear-gradient(180deg, rgba(32, 23, 39, 0.94), rgba(14, 10, 19, 0.97));
  box-shadow:
    var(--land-rim),
    0 40px 80px -44px rgba(0, 0, 0, 0.85);
  overflow: hidden;
}
.land-rt:not(.is-flat) .land-rt__screen {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--rt-window);
  margin: 0;
  opacity: 0;
  transform: translateY(16px) scale(0.985);
  pointer-events: none;
  transition:
    opacity 0.45s var(--land-ease),
    transform 0.6s var(--land-ease);
}
.land-rt:not(.is-flat) .land-rt__station.is-done .land-rt__screen {
  transform: translateY(-16px) scale(0.985);
}
.land-rt:not(.is-flat) .land-rt__station.is-active .land-rt__screen {
  opacity: 1;
  transform: none;
}
.land-rt__bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--land-border);
}
.land-rt__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.65rem;
  border-radius: 0.6rem;
  font-family: var(--land-mono);
  font-size: 0.68rem;
  color: var(--land-text-3);
  white-space: nowrap;
}
.land-rt__tab.is-on {
  background: rgba(255, 255, 255, 0.07);
  color: var(--land-text);
}
.land-rt__demo {
  margin-left: auto;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(201, 161, 228, 0.16);
  font-family: var(--land-mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--land-lavender);
}
@media (max-width: 520px) {
  .land-rt__tab:not(.is-on) {
    font-size: 0;
    gap: 0;
  }
}
.land-rt__view {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1rem;
  padding: clamp(1.1rem, 3vw, 2rem);
}
.land-rt__view-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}
.land-rt__view-title code {
  font-family: var(--land-mono);
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--land-text-3);
}
.land-rt__phase {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.66rem;
  font-weight: 400;
  color: var(--land-text-3);
  transition:
    color 0.4s var(--land-ease),
    border-color 0.4s var(--land-ease);
}
.land-rt__phase::before {
  content: '';
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: currentColor;
}
.land-rt__phase.is-busy {
  color: var(--land-orange);
  border-color: rgba(245, 161, 107, 0.4);
}
.land-rt__phase.is-ok {
  color: #9fd9b9;
  border-color: rgba(47, 166, 107, 0.4);
}

/* 01 · record */
.land-rt__record {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.land-rt__record > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0.9rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--land-border);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 0.4s var(--land-ease),
    transform 0.4s var(--land-ease);
}
.land-rt__record > div.is-in {
  opacity: 1;
  transform: none;
}
.land-rt__record dt {
  font-size: 0.86rem;
  color: var(--land-text-2);
}
.land-rt__record dd {
  margin: 0;
  font-family: var(--land-mono);
  font-size: 0.82rem;
  color: var(--land-text);
}
.land-rt__deploy {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1rem;
  border-radius: 999px;
  background: rgba(245, 161, 107, 0.14);
  border: 1px solid rgba(245, 161, 107, 0.35);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--land-orange);
  transition:
    background-color 0.35s var(--land-ease),
    color 0.35s var(--land-ease),
    box-shadow 0.35s var(--land-ease),
    transform 0.35s var(--land-ease);
}
.land-rt__deploy.is-pressed {
  background: var(--land-orange);
  color: #120c18;
  box-shadow: 0 0 0 6px rgba(245, 161, 107, 0.14), 0 12px 30px -10px rgba(245, 161, 107, 0.7);
  transform: scale(0.97);
}

/* 02 · workflow */
.land-rt__flow {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.land-rt__flow li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.65rem 0;
  font-size: 0.95rem;
  color: var(--land-text-3);
  transition: color 0.4s var(--land-ease);
}
.land-rt__flow li + li::before {
  content: '';
  position: absolute;
  left: calc(0.7rem - 0.5px);
  top: -0.6rem;
  height: 1.2rem;
  width: 1px;
  background: var(--land-border-2);
}
.land-rt__flow li.is-done + li::before {
  background: var(--land-lavender);
}
.land-rt__flow li.is-run,
.land-rt__flow li.is-done {
  color: var(--land-text);
}
.land-rt__flow-dot {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  border: 1px solid var(--land-border-2);
  background: #150f1b;
  color: var(--land-lavender);
  transition:
    border-color 0.4s var(--land-ease),
    background-color 0.4s var(--land-ease);
}
.land-rt__flow li.is-run .land-rt__flow-dot {
  border-color: rgba(245, 161, 107, 0.7);
}
.land-rt__flow li.is-done .land-rt__flow-dot {
  border-color: rgba(201, 161, 228, 0.6);
  background: rgba(201, 161, 228, 0.16);
}
.land-rt__spin {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 999px;
  border: 1.5px solid rgba(245, 161, 107, 0.3);
  border-top-color: var(--land-orange);
  animation: land-rt-spin 0.9s linear infinite;
}
@keyframes land-rt-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 03 · pod */
.land-rt__requests {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
.land-rt__requests span {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.6rem 0.8rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--land-border);
}
.land-rt__requests i {
  font-style: normal;
  font-family: var(--land-mono);
  font-size: 0.64rem;
  color: var(--land-text-3);
}
.land-rt__requests b {
  font-family: var(--land-mono);
  font-size: 1.05rem;
  font-weight: 500;
}
.land-rt__log {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.8rem 0.9rem;
  border-radius: 0.6rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--land-border);
  font-family: var(--land-mono);
  font-size: 0.76rem;
  color: var(--land-text-3);
}
.land-rt__log span {
  opacity: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    opacity 0.35s var(--land-ease),
    color 0.5s var(--land-ease);
}
.land-rt__log span.is-in {
  opacity: 1;
}
.land-rt__log span.is-hi {
  color: var(--land-orange);
}

/* 04 · chat */
.land-rt__view--chat {
  justify-content: flex-end;
  gap: 0.7rem;
}
.land-rt__chat-head {
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
.land-rt__chat-head .land-rt__phase {
  margin-left: 0;
}
.land-rt__mono {
  margin-left: auto;
  color: var(--land-text-3);
  font-size: 0.66rem;
}
.land-rt__av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: linear-gradient(135deg, #251b2b, #4a3356);
  font-family: var(--land-font);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--land-text);
}
.land-rt__sys {
  align-self: center;
  font-family: var(--land-mono);
  font-size: 0.66rem;
  color: var(--land-text-3);
}
.land-rt__sys,
.land-rt__bubble {
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.4s var(--land-ease),
    transform 0.4s var(--land-ease);
}
.land-rt__sys.is-in,
.land-rt__bubble.is-in {
  opacity: 1;
  transform: none;
}
.land-rt__bubble {
  align-self: flex-start;
  max-width: 80%;
  padding: 0.65rem 0.9rem;
  border-radius: 1rem 1rem 1rem 0.3rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--land-border);
  font-size: 0.94rem;
  line-height: 1.45;
}
.land-rt__bubble--me {
  align-self: flex-end;
  border-radius: 1rem 1rem 0.3rem 1rem;
  background: var(--land-text);
  color: #120c18;
  border-color: transparent;
}
/* The reply keeps its final size from the first word, so scrolling back and
   forth never changes the window's layout. */
.land-rt__word {
  opacity: 0;
  transition: opacity 0.25s ease-out;
}
.land-rt__word.is-in {
  opacity: 1;
}

/* ── Light round the window (pinned layout only) ───────────────────── */
.land-rt__dots,
.land-rt__bloom,
.land-rt__ring {
  display: none;
}
.land-rt:not(.is-flat) .land-rt__dots,
.land-rt:not(.is-flat) .land-rt__bloom,
.land-rt:not(.is-flat) .land-rt__ring {
  display: block;
  position: absolute;
  pointer-events: none;
}
.land-rt:not(.is-flat) .land-rt__dots {
  right: -7%;
  top: -22%;
  width: 46%;
  height: 78%;
  --dots-opacity: 0.4;
}
.land-rt__bloom,
.land-rt__ring {
  /* `--p` (0–1, the scroll position on the track) turns the light round the
     window and warms it. */
  --angle: calc(var(--p, 0) * 300deg + 215deg);
  --glow: color-mix(in oklab, var(--land-orange) calc(var(--p, 0) * 100%), var(--land-lavender));
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--rt-window);
  border-radius: 1.25rem;
}
.land-rt__bloom {
  inset: -2rem -2rem -2rem auto;
  width: calc(var(--rt-window) + 4rem);
  border-radius: 3rem;
  background: conic-gradient(from var(--angle), transparent 0deg, var(--glow) 55deg, transparent 120deg);
  filter: blur(42px);
  opacity: 0.62;
}
.land-rt__ring {
  z-index: 2;
  padding: 1.5px;
  background: conic-gradient(from var(--angle), transparent 0deg, var(--glow) 40deg, #fff 55deg, var(--glow) 70deg, transparent 115deg);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.land-rt__note {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1.25rem 0 0;
  font-size: 0.82rem;
  color: var(--land-text-3);
}
.land-rt:not(.is-flat) .land-rt__note:first-child {
  margin-top: 2.5rem;
}
.land-rt__note--demo {
  margin-top: 0.5rem;
}
</style>
