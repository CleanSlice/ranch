<template>
  <div ref="fxRoot" class="land-stage">
    <div class="land-stage__glow" aria-hidden="true" />
    <div class="land-stage__panel">
      <!-- The hero's one looping effect: a slow copper light around the panel
           edge, so the eye is led to the demo (effects contract #1). -->
      <BorderBeam :duration="fx.borderBeamSeconds" :border-width="1.25" :size="220" />
      <!-- Agent + controls -->
      <aside class="land-stage__side">
        <div class="land-stage__side-head">
          <span class="land-stage__kicker">
            <LandingBrandLogo variant="symbol" :size="18" mono :label="null" />
            {{ $t('stage.kicker') }}
          </span>
          <span class="land-stage__badge" :class="{ 'is-live': agent }">
            {{ agent ? $t('stage.live') : $t('stage.demo') }}
          </span>
        </div>

        <div class="land-stage__agent">
          <span class="land-stage__avatar">{{ initial }}</span>
          <span class="land-stage__agent-text">
            <span class="land-stage__agent-name">{{ agent?.name ?? $t('stage.demo_agent') }}</span>
            <span class="land-stage__agent-sub">{{ agent?.templateId ?? $t('stage.demo_template') }}</span>
          </span>
        </div>

        <div class="land-stage__status">
          <span class="land-stage__dot" :class="`is-${status}`" />
          {{ statusLabel }}
        </div>

        <dl class="land-stage__res">
          <div>
            <dt>CPU</dt>
            <dd>{{ agent?.resources.cpu ?? '500m' }}</dd>
          </div>
          <div>
            <dt>{{ $t('stage.memory') }}</dt>
            <dd>{{ agent?.resources.memory ?? '1Gi' }}</dd>
          </div>
        </dl>

        <div class="land-stage__tabs" role="tablist" :aria-label="$t('stage.views')" @keydown="onTabKeydown">
          <button
            v-for="(item, i) in tabs"
            :id="`land-tab-${item}`"
            :key="item"
            :ref="(el) => (tabEls[i] = el as HTMLButtonElement)"
            type="button"
            role="tab"
            class="land-stage__tab"
            :class="{ 'is-active': tab === item }"
            :aria-selected="tab === item"
            :aria-controls="`land-panel-${item}`"
            :tabindex="tab === item ? 0 : -1"
            @click="tab = item"
          >
            {{ $t(`stage.tab_${item}`) }}
            <span v-if="item !== 'chat' || !agent" class="land-stage__tab-note">{{ $t('stage.demo') }}</span>
          </button>
        </div>

        <div class="land-stage__actions">
          <NuxtLink
            v-if="agent"
            :to="`/agents/${agent.id}`"
            class="land-stage__action"
          >
            <Icon name="refresh-cw" :size="14" />
            {{ $t('stage.restart') }}
          </NuxtLink>
          <button v-else type="button" class="land-stage__action" disabled :title="$t('stage.needs_agent')">
            <Icon name="refresh-cw" :size="14" />
            {{ $t('stage.restart') }}
          </button>
          <NuxtLink
            v-if="agent"
            :to="`/agents/${agent.id}`"
            class="land-stage__action"
          >
            <Icon name="scroll-text" :size="14" />
            {{ $t('stage.logs') }}
          </NuxtLink>
          <button v-else type="button" class="land-stage__action" disabled :title="$t('stage.needs_agent')">
            <Icon name="scroll-text" :size="14" />
            {{ $t('stage.logs') }}
          </button>
        </div>
      </aside>

      <!-- Views -->
      <div class="land-stage__main">
        <Transition name="land-view" mode="out-in">
          <!-- Chat: the real Bridle chat when a public agent allows this origin -->
          <section
            v-if="tab === 'chat'"
            id="land-panel-chat"
            key="chat"
            role="tabpanel"
            aria-labelledby="land-tab-chat"
            class="land-stage__view land-stage__view--chat"
          >
            <header class="land-stage__view-head">
              <span>{{ $t('stage.chat_title') }}</span>
              <span class="land-stage__mono">socket.io · jwt · streaming</span>
            </header>
            <div v-if="agent" class="land-stage__chat">
              <BridleChatProvider :agent-id="agent.id" :title="agent.name" :show-header="false" />
            </div>
            <div v-else class="land-stage__empty">
              <LandingBrandLogo variant="symbol" :size="40" mono :label="null" class="land-stage__empty-icon" />
              <p class="land-stage__empty-title">{{ $t('hero.no_agent_title') }}</p>
              <p class="land-stage__empty-text">{{ $t('hero.no_agent_lede', { origin }) }}</p>
            </div>
          </section>

          <!-- Runtime: the lifecycle the console tracks, in its own words -->
          <section
            v-else-if="tab === 'runtime'"
            id="land-panel-runtime"
            key="runtime"
            role="tabpanel"
            aria-labelledby="land-tab-runtime"
            class="land-stage__view"
          >
            <header class="land-stage__view-head">
              <span>{{ $t('stage.runtime_title') }}</span>
              <span class="land-stage__mono">k3s · argo workflows</span>
            </header>
            <ol class="land-stage__life">
              <li
                v-for="(step, i) in lifecycle"
                :key="step"
                class="land-stage__life-step"
                :class="{ 'is-done': i < runtimeIndex, 'is-active': i === runtimeIndex }"
              >
                <span class="land-stage__life-marker">
                  <Icon v-if="i < runtimeIndex" name="check" :size="12" />
                  <span v-else class="land-stage__life-pip" />
                </span>
                <span class="land-stage__life-text">
                  <span class="land-stage__life-title">{{ $t(`status.${step}`) }}</span>
                  <span class="land-stage__life-sub">{{ $t(`stage.life_${step}`) }}</span>
                </span>
                <span class="land-stage__mono land-stage__life-phase">{{ phaseFor(step) }}</span>
              </li>
            </ol>
            <p class="land-stage__foot">
              <Icon name="activity" :size="12" />
              {{ agent ? $t('stage.runtime_live_note') : $t('stage.runtime_demo_note') }}
            </p>
          </section>

          <!-- Workflow: what Argo does between "deploy" and "online" -->
          <section
            v-else
            id="land-panel-workflow"
            key="workflow"
            role="tabpanel"
            aria-labelledby="land-tab-workflow"
            class="land-stage__view"
          >
            <header class="land-stage__view-head">
              <span>{{ $t('stage.workflow_title') }}</span>
              <span class="land-stage__mono">{{ workflowDone ? 'Succeeded' : 'Running' }}</span>
            </header>
            <div class="land-stage__flow">
              <div
                v-for="(node, i) in workflow"
                :key="node"
                class="land-stage__flow-node"
                :class="{ 'is-done': i < workflowIndex, 'is-active': i === workflowIndex }"
              >
                <span class="land-stage__flow-index">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="land-stage__flow-title">{{ $t(`stage.flow_${node}`) }}</span>
                <span class="land-stage__flow-state">
                  <Icon v-if="i < workflowIndex" name="check" :size="12" />
                  <Icon v-else-if="i === workflowIndex" name="loader-2" :size="12" class="land-stage__spin" />
                  <span v-else>·</span>
                </span>
                <span v-if="i < workflow.length - 1" class="land-stage__flow-line" aria-hidden="true" />
              </div>
            </div>
            <p class="land-stage__foot">
              <Icon name="info" :size="12" />
              {{ $t('stage.workflow_note') }}
            </p>
          </section>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IAgentData } from '#agent/stores/agent';

const props = defineProps<{
  agent: IAgentData | null;
  origin: string;
}>();

const { t, te } = useI18n();

// Effect settings from the landing tokens; the border beam pauses while the
// hero is off screen or the tab is hidden.
const fx = useFxTokens();
const fxRoot = ref<HTMLElement | null>(null);
useFxPause(fxRoot);

type Tab = 'chat' | 'runtime' | 'workflow';
const tabs: Tab[] = ['chat', 'runtime', 'workflow'];
// A real conversation is the strongest proof the product exists; without a
// public agent the workflow view is the most informative default.
const tab = ref<Tab>(props.agent ? 'chat' : 'workflow');
const tabEls = ref<HTMLButtonElement[]>([]);

function onTabKeydown(event: KeyboardEvent) {
  const i = tabs.indexOf(tab.value);
  let next = i;
  if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  tab.value = tabs[next]!;
  tabEls.value[next]?.focus();
}

const initial = computed(() => (props.agent?.name ?? 'R').trim().charAt(0).toUpperCase());

// Status vocabulary is the console's (`status.*` keys live in the agent slice).
const status = computed(() => props.agent?.status ?? 'running');
const statusLabel = computed(() => {
  const key = `status.${status.value}`;
  return te(key) ? t(key) : status.value;
});

// ── Runtime view ────────────────────────────────────────────────────────
const lifecycle = ['pending', 'deploying', 'running'] as const;
const phases: Record<string, string> = {
  pending: 'Pending',
  deploying: 'Running',
  running: 'Succeeded',
};
function phaseFor(step: string) {
  return phases[step] ?? '';
}
const demoRuntime = ref(0);
const runtimeIndex = computed(() => {
  if (props.agent) {
    const i = lifecycle.indexOf(status.value as (typeof lifecycle)[number]);
    return i === -1 ? lifecycle.length : i;
  }
  return demoRuntime.value;
});

// ── Workflow view ───────────────────────────────────────────────────────
const workflow = ['submit', 'schedule', 'pull', 'start', 'online'] as const;
const workflowIndex = ref(0);
const workflowDone = computed(() => workflowIndex.value >= workflow.length);

// One timeline drives both demos: nothing here pretends to be a backend
// event, the labels say Demo, and reduced motion shows the finished state.
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    workflowIndex.value = workflow.length;
    demoRuntime.value = lifecycle.length - 1;
    return;
  }
  let tick = 0;
  timer = setInterval(() => {
    tick += 1;
    workflowIndex.value = tick % (workflow.length + 3);
    if (workflowIndex.value > workflow.length) workflowIndex.value = workflow.length;
    demoRuntime.value = Math.min(lifecycle.length - 1, Math.floor((tick % 7) / 2));
  }, 1400);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.land-stage {
  position: relative;
}
.land-stage__glow {
  position: absolute;
  left: 10%;
  right: 10%;
  top: -12%;
  height: 50%;
  border-radius: 999px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(245, 161, 107, 0.32) 0%, rgba(245, 161, 107, 0) 70%);
  filter: blur(34px);
  pointer-events: none;
}
.land-stage__panel {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  border-radius: 1.25rem;
  background: var(--land-panel);
  color: var(--land-panel-text);
  box-shadow:
    0 40px 120px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
@media (min-width: 900px) {
  .land-stage__panel {
    grid-template-columns: 280px minmax(0, 1fr);
    height: 480px;
  }
}

/* Side */
.land-stage__side {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.1rem 1.1rem 1rem;
  background: var(--land-panel-2);
  border-bottom: 1px solid var(--land-panel-border);
}
@media (min-width: 900px) {
  .land-stage__side {
    padding: 1.35rem 1.25rem;
    gap: 1.1rem;
    border-bottom: 0;
    border-right: 1px solid var(--land-panel-border);
  }
}
.land-stage__side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.land-stage__kicker {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--land-panel-text-2);
}
.land-stage__badge {
  font-family: var(--land-mono);
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(201, 161, 228, 0.28);
  color: #6b4c85;
}
.land-stage__badge.is-live {
  background: rgba(47, 166, 107, 0.16);
  color: #1c7a4c;
}
.land-stage__agent {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.land-stage__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.8rem;
  background: linear-gradient(135deg, #251b2b, #4a3356);
  color: var(--land-text);
  font-weight: 600;
  flex: none;
}
.land-stage__agent-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.land-stage__agent-name {
  font-size: 0.95rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.land-stage__agent-sub {
  font-family: var(--land-mono);
  font-size: 0.7rem;
  color: #8a7f94;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.land-stage__status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  color: #3b3344;
}
.land-stage__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #9a92a3;
  box-shadow: 0 0 0 4px rgba(154, 146, 163, 0.15);
}
.land-stage__dot.is-running {
  background: var(--land-ok);
  box-shadow: 0 0 0 4px rgba(47, 166, 107, 0.15);
}
.land-stage__dot.is-deploying,
.land-stage__dot.is-pending {
  background: var(--land-orange);
  box-shadow: 0 0 0 4px rgba(245, 161, 107, 0.2);
}
.land-stage__dot.is-failed {
  background: #d6453d;
  box-shadow: 0 0 0 4px rgba(214, 69, 61, 0.15);
}
.land-stage__res {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}
.land-stage__res div {
  padding: 0.55rem 0.75rem;
  border-radius: 0.65rem;
  background: var(--land-panel);
  border: 1px solid var(--land-panel-border);
}
.land-stage__res dt {
  font-size: 0.68rem;
  color: #8a7f94;
}
.land-stage__res dd {
  margin: 0;
  font-family: var(--land-mono);
  font-size: 0.85rem;
  font-weight: 500;
}
.land-stage__tabs {
  display: flex;
  gap: 0.25rem;
}
@media (min-width: 900px) {
  .land-stage__tabs {
    flex-direction: column;
  }
}
.land-stage__tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.5rem 0.8rem;
  border-radius: 0.65rem;
  border: 0;
  background: transparent;
  color: #3b3344;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.3s var(--land-ease),
    color 0.3s var(--land-ease);
}
.land-stage__tab:hover {
  background: rgba(26, 20, 33, 0.06);
}
.land-stage__tab.is-active {
  background: var(--land-panel-text);
  color: var(--land-text);
}
.land-stage__tab:focus-visible {
  outline: 2px solid var(--land-copper);
  outline-offset: 2px;
}
.land-stage__tab-note {
  font-family: var(--land-mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.55;
}
@media (max-width: 899px) {
  .land-stage__tab {
    justify-content: center;
    text-align: center;
  }
  .land-stage__tab-note {
    display: none;
  }
}
.land-stage__actions {
  display: none;
  gap: 0.5rem;
  margin-top: auto;
}
@media (min-width: 900px) {
  .land-stage__actions {
    display: flex;
  }
}
.land-stage__action {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 2.3rem;
  border-radius: 999px;
  border: 1px solid rgba(26, 20, 33, 0.14);
  background: var(--land-panel);
  color: var(--land-panel-text);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.3s var(--land-ease),
    background-color 0.3s var(--land-ease);
}
.land-stage__action:hover:not(:disabled) {
  border-color: rgba(26, 20, 33, 0.3);
}
.land-stage__action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.land-stage__action:focus-visible {
  outline: 2px solid var(--land-copper);
  outline-offset: 2px;
}

/* Main */
.land-stage__main {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.land-stage__view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 380px;
}
@media (min-width: 900px) {
  .land-stage__view {
    min-height: 0;
  }
}
.land-stage__view-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  height: 3.1rem;
  padding: 0 1.25rem;
  border-bottom: 1px solid var(--land-panel-border);
  font-size: 0.82rem;
  color: var(--land-panel-text-2);
  flex: none;
}
.land-stage__mono {
  font-family: var(--land-mono);
  font-size: 0.68rem;
  letter-spacing: 0.02em;
  color: #8a7f94;
  white-space: nowrap;
}
.land-stage__chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.land-stage__chat > * {
  flex: 1;
  min-height: 0;
}
.land-stage__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  gap: 0.4rem;
}
.land-stage__empty-icon {
  color: #b4a9bd;
  margin-bottom: 0.5rem;
}
.land-stage__empty-title {
  margin: 0;
  font-weight: 600;
  font-size: 0.95rem;
}
.land-stage__empty-text {
  margin: 0;
  max-width: 24rem;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--land-panel-text-2);
}
.land-stage__foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: auto 0 0;
  padding: 0.9rem 1.25rem;
  font-size: 0.74rem;
  color: #8a7f94;
  border-top: 1px solid var(--land-panel-border);
}

/* Runtime */
.land-stage__life {
  list-style: none;
  margin: 0;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.land-stage__life-step {
  display: grid;
  grid-template-columns: 1.6rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 0.8rem;
  border: 1px solid transparent;
  transition:
    background-color 0.5s var(--land-ease),
    border-color 0.5s var(--land-ease),
    opacity 0.5s var(--land-ease);
  opacity: 0.55;
}
.land-stage__life-step.is-done {
  opacity: 0.85;
}
.land-stage__life-step.is-active {
  opacity: 1;
  background: #fff;
  border-color: var(--land-panel-border);
  box-shadow: 0 10px 30px rgba(26, 20, 33, 0.08);
}
.land-stage__life-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: rgba(26, 20, 33, 0.06);
  color: #1c7a4c;
}
.land-stage__life-step.is-done .land-stage__life-marker {
  background: rgba(47, 166, 107, 0.15);
}
.land-stage__life-pip {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #b4a9bd;
}
.land-stage__life-step.is-active .land-stage__life-pip {
  background: var(--land-orange);
  box-shadow: 0 0 0 4px rgba(245, 161, 107, 0.22);
}
.land-stage__life-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.land-stage__life-title {
  font-size: 0.88rem;
  font-weight: 600;
}
.land-stage__life-sub {
  font-size: 0.74rem;
  color: var(--land-panel-text-2);
}

/* Workflow */
.land-stage__flow {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.land-stage__flow-node {
  position: relative;
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) 1.5rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.6rem 0.55rem 0.4rem;
  border-radius: 0.7rem;
  opacity: 0.5;
  transition:
    opacity 0.5s var(--land-ease),
    background-color 0.5s var(--land-ease);
}
.land-stage__flow-node.is-done {
  opacity: 0.9;
}
.land-stage__flow-node.is-active {
  opacity: 1;
  background: #fff;
  box-shadow: 0 10px 30px rgba(26, 20, 33, 0.08);
}
.land-stage__flow-index {
  font-family: var(--land-pixel);
  font-size: 0.8rem;
  color: var(--land-copper);
  text-align: center;
}
.land-stage__flow-title {
  font-size: 0.86rem;
  font-weight: 500;
}
.land-stage__flow-state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  color: #1c7a4c;
  background: rgba(26, 20, 33, 0.05);
}
.land-stage__flow-node.is-active .land-stage__flow-state {
  color: var(--land-copper);
  background: rgba(245, 161, 107, 0.18);
}
.land-stage__flow-line {
  position: absolute;
  left: 1.15rem;
  top: calc(100% - 0.2rem);
  width: 1px;
  height: 0.75rem;
  background: rgba(26, 20, 33, 0.14);
}
.land-stage__spin {
  animation: land-spin 1s linear infinite;
}
@keyframes land-spin {
  to {
    transform: rotate(360deg);
  }
}

/* View switch */
.land-view-enter-active,
.land-view-leave-active {
  transition:
    opacity 0.28s var(--land-ease),
    transform 0.32s var(--land-ease);
}
.land-view-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.land-view-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
