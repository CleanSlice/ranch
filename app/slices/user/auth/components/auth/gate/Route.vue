<template>
  <!-- The session route: you → RANCH hub → your agents. Decorative mirror
       of the form state; the form itself says what actually happened. -->
  <ol class="gate-route" :class="[`is-${stage}`, { 'gate-route--row': row }]" aria-hidden="true">
    <li class="gate-route__node is-you">
      <span class="gate-route__dot" />
      <span class="gate-route__text">
        <span class="gate-route__title">{{ $t('gate.node_you') }}</span>
        <span class="gate-route__sub">{{ $t('gate.node_you_sub') }}</span>
      </span>
    </li>
    <li class="gate-route__link"><span /></li>
    <li class="gate-route__node is-hub">
      <span class="gate-route__dot" />
      <span class="gate-route__text">
        <span class="gate-route__title">{{ $t('gate.node_hub') }}</span>
        <span class="gate-route__sub">{{ $t('gate.node_hub_sub') }}</span>
      </span>
    </li>
    <li class="gate-route__link"><span /></li>
    <li class="gate-route__node is-agents">
      <span class="gate-route__dot" />
      <span class="gate-route__text">
        <span class="gate-route__title">{{ $t('gate.node_agents') }}</span>
        <span class="gate-route__sub">{{ $t('gate.node_agents_sub') }}</span>
      </span>
    </li>
  </ol>
</template>

<script setup lang="ts">
import type { GateStage } from '#auth/composables/useGateStage';

defineProps<{
  stage: GateStage;
  /** Horizontal, compact variant for phones. */
  row?: boolean;
}>();
</script>

<style scoped>
.gate-route {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.gate-route__node {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.gate-route__dot {
  flex: none;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 999px;
  background: #5a4f63;
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.04);
  transition:
    background-color 0.6s var(--land-ease),
    box-shadow 0.6s var(--land-ease);
}
.gate-route__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.gate-route__title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #c9c0d0;
  transition: color 0.6s var(--land-ease);
  white-space: nowrap;
}
.gate-route__sub {
  font-family: var(--land-mono);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  color: var(--land-text-3);
}
.gate-route__link {
  height: 2.75rem;
  padding-left: calc(0.4375rem - 0.5px);
}
.gate-route__link span {
  display: block;
  width: 1px;
  height: 100%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06));
  position: relative;
  overflow: hidden;
}
/* A light travelling down a link while that hop is in progress. */
.gate-route__link span::after {
  content: '';
  position: absolute;
  left: 0;
  top: -40%;
  width: 100%;
  height: 40%;
  background: linear-gradient(180deg, rgba(245, 161, 107, 0), var(--land-orange));
  opacity: 0;
}

/* Lit nodes */
.gate-route .is-you .gate-route__dot,
.gate-route.is-connecting .is-hub .gate-route__dot {
  background: var(--land-orange);
  box-shadow:
    0 0 0 6px rgba(245, 161, 107, 0.18),
    0 0 18px rgba(245, 161, 107, 0.8);
}
.gate-route .is-you .gate-route__title,
.gate-route.is-connecting .is-hub .gate-route__title {
  color: var(--land-text);
}
.gate-route .is-hub .gate-route__dot {
  background: #8f6aa8;
}
.gate-route.is-filling .is-hub .gate-route__dot {
  background: var(--land-lavender);
  box-shadow: 0 0 0 6px rgba(201, 161, 228, 0.14);
}
.gate-route.is-failed .is-hub .gate-route__dot {
  background: #d6453d;
  box-shadow: 0 0 0 6px rgba(214, 69, 61, 0.18);
}
.gate-route .is-agents .gate-route__dot {
  background: #e9e2ee;
  opacity: 0.55;
}

/* Hop animations */
.gate-route.is-filling .gate-route__link:nth-child(2) span::after,
.gate-route.is-connecting .gate-route__link:nth-child(4) span::after {
  opacity: 1;
  animation: gate-hop 1.6s var(--land-ease) infinite;
}
@keyframes gate-hop {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(350%);
  }
}

/* Row variant (phones) */
.gate-route--row {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
}
.gate-route--row .gate-route__node {
  gap: 0.5rem;
}
.gate-route--row .gate-route__dot {
  width: 0.625rem;
  height: 0.625rem;
}
.gate-route--row .gate-route__title {
  font-size: 0.8rem;
}
.gate-route--row .gate-route__sub {
  display: none;
}
.gate-route--row .gate-route__link {
  flex: 1;
  min-width: 0.875rem;
  height: 1px;
  padding: 0;
}
.gate-route--row .gate-route__link span {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06));
}
.gate-route--row .gate-route__link span::after {
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, rgba(245, 161, 107, 0), var(--land-orange));
}
.gate-route--row.is-filling .gate-route__link:nth-child(2) span::after,
.gate-route--row.is-connecting .gate-route__link:nth-child(4) span::after {
  animation-name: gate-hop-x;
}
@keyframes gate-hop-x {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(350%);
  }
}
</style>
