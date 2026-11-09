<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import { orbitLayout } from '#agent/utils/orbitLayout';
import { agentInitials, agentStatusMeta } from '#agent/utils/agentStatus';

/**
 * The orbit map: every agent is a node on a ring around the RANCH hub, the
 * live ones on the inner ring. Status is the node's colour, so the whole
 * fleet reads at a glance; the selected agent is the lit node.
 *
 * Nodes are real buttons, so the keyboard works the way it does anywhere
 * else: Tab reaches the map, arrows walk the ring, Enter opens the agent.
 * The dashed rings and the link lines are decoration (SVG, aria-hidden).
 */
const props = defineProps<{
  agents: IAgentData[] | null | undefined;
  activeId: string;
  /** Initial load only — a refresh keeps the existing nodes in place. */
  pending: boolean;
  /** Dims every node that does not match; empty shows all. */
  search: string;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const el = ref<HTMLElement | null>(null);
const size = ref({ w: 0, h: 0 });
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!el.value) return;
  const measure = () => {
    if (!el.value) return;
    size.value = { w: el.value.clientWidth, h: el.value.clientHeight };
  };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(el.value);
});
onBeforeUnmount(() => observer?.disconnect());

const NODE = 40;
const NODE_ACTIVE = 48;
const LABEL_GAP = 7;

// Rings are ellipses: the map pane is wider than it is tall and the labels
// of the outer ring need room on the sides, less above and below.
const geometry = computed(() => {
  const { w, h } = size.value;
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(120, w / 2 - 110);
  const ry = Math.max(100, h / 2 - 64);
  return { cx, cy, rx, ry };
});

const layout = computed(() => orbitLayout(props.agents ?? []));

const term = computed(() => props.search.trim().toLowerCase());

interface PlacedNode {
  id: string;
  agent: IAgentData;
  ring: number;
  x: number;
  y: number;
  /** Degrees, for the link line. */
  lineDeg: number;
  lineLength: number;
  initials: string;
  meta: ReturnType<typeof agentStatusMeta>;
  active: boolean;
  match: boolean;
  labelStyle: Record<string, string>;
  labelAlign: 'left' | 'right' | 'center';
}

const nodes = computed<PlacedNode[]>(() => {
  const { cx, cy, rx, ry } = geometry.value;
  return layout.value.nodes.map((node) => {
    const x = cx + node.x * rx;
    const y = cy + node.y * ry;
    const active = node.agent.id === props.activeId;
    const half = (active ? NODE_ACTIVE : NODE) / 2;
    // Labels point away from the hub; the ring gaps are sized for them.
    const dx = Math.cos(node.angle);
    const dy = Math.sin(node.angle);
    const ax = x + dx * (half + LABEL_GAP);
    const ay = y + dy * (half + LABEL_GAP);
    let labelAlign: PlacedNode['labelAlign'] = 'center';
    let transform = dy > 0 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
    if (dx > 0.35) {
      labelAlign = 'left';
      transform = 'translate(0, -50%)';
    } else if (dx < -0.35) {
      labelAlign = 'right';
      transform = 'translate(-100%, -50%)';
    }
    const match = !term.value || node.agent.name.toLowerCase().includes(term.value);
    return {
      id: node.agent.id,
      agent: node.agent,
      ring: node.ring,
      x,
      y,
      lineDeg: (Math.atan2(y - cy, x - cx) * 180) / Math.PI,
      lineLength: Math.hypot(x - cx, y - cy),
      initials: agentInitials(node.agent.name, node.agent.id),
      meta: agentStatusMeta(node.agent.status),
      active,
      match,
      labelStyle: { left: `${ax}px`, top: `${ay}px`, transform },
      labelAlign,
    };
  });
});

const rings = computed(() => {
  const { cx, cy, rx, ry } = geometry.value;
  return layout.value.radii.map((r, i) => ({ i, cx, cy, rx: rx * r, ry: ry * r }));
});

const hasSearchMiss = computed(
  () => !!term.value && nodes.value.length > 0 && !nodes.value.some((n) => n.match),
);

const adminAgent = computed(() => props.agents?.find((a) => a.isAdmin) ?? null);

// Arrows walk the ring in orbit order; Enter and Space are the button's own.
function onKeydown(event: KeyboardEvent) {
  const step =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
  if (!step || !el.value) return;
  const buttons = Array.from(
    el.value.querySelectorAll<HTMLButtonElement>('[data-orbit-node]'),
  );
  if (!buttons.length) return;
  const current = buttons.findIndex((b) => b === document.activeElement);
  const next =
    current === -1
      ? Math.max(0, buttons.findIndex((b) => b.dataset.active === 'true'))
      : (current + step + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
}
</script>

<template>
  <div
    ref="el"
    class="agent-orbit relative h-full w-full select-none overflow-hidden"
    role="group"
    :aria-label="$t('orbit.map_label')"
    @keydown="onKeydown"
  >
    <!-- Rings and link lines. Decoration only: the nodes carry the meaning. -->
    <svg
      v-if="size.w && nodes.length"
      class="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="agent-orbit-hub-glow">
          <stop offset="0%" stop-color="#f5a16b" stop-opacity="0.55" />
          <stop offset="70%" stop-color="#f5a16b" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g class="agent-orbit__rings">
        <ellipse
          v-for="ring in rings"
          :key="ring.i"
          :cx="ring.cx"
          :cy="ring.cy"
          :rx="ring.rx"
          :ry="ring.ry"
          fill="none"
          stroke="rgba(201,161,228,0.2)"
          stroke-dasharray="3 7"
        />
      </g>
      <line
        v-for="node in nodes"
        :key="node.id"
        :x1="geometry.cx"
        :y1="geometry.cy"
        :x2="node.x"
        :y2="node.y"
        :stroke="node.active ? '#f5a16b' : node.meta.color"
        :stroke-opacity="node.active ? 0.7 : node.match ? 0.28 : 0.08"
        stroke-width="1"
      />
      <circle
        :cx="geometry.cx"
        :cy="geometry.cy"
        r="54"
        fill="url(#agent-orbit-hub-glow)"
      />
    </svg>

    <!-- The hub. Clicking it opens the Ranch admin agent, the one that
         manages the rest; without one it is only the centre of the map. -->
    <component
      :is="adminAgent ? 'button' : 'div'"
      v-if="size.w"
      :type="adminAgent ? 'button' : undefined"
      class="agent-orbit__hub absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
      :class="adminAgent && 'cursor-pointer'"
      :style="{ left: `${geometry.cx}px`, top: `${geometry.cy}px` }"
      :title="adminAgent ? $t('rail.admin_agent') : undefined"
      :aria-label="adminAgent ? $t('rail.admin_agent') : undefined"
      @click="adminAgent && emit('select', adminAgent.id)"
    >
      <LandingBrandLogo variant="mark" :size="44" />
    </component>

    <!-- Placeholder nodes while the list loads: the map keeps its shape. -->
    <template v-if="pending && !nodes.length && size.w">
      <span
        v-for="i in 6"
        :key="i"
        class="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-[14px] bg-muted"
        :style="{
          left: `${geometry.cx + geometry.rx * Math.cos(-Math.PI / 2 + ((i - 1) * Math.PI) / 3)}px`,
          top: `${geometry.cy + geometry.ry * Math.sin(-Math.PI / 2 + ((i - 1) * Math.PI) / 3)}px`,
        }"
      />
    </template>

    <template v-for="(node, index) in nodes" :key="node.id">
      <button
        type="button"
        data-orbit-node
        :data-active="node.active ? 'true' : 'false'"
        class="agent-orbit__node absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[14px] border bg-linear-to-br from-[#4a3356] to-[#1a1421] text-[11px] font-semibold text-foreground outline-none transition-[opacity,box-shadow,width,height] duration-300 focus-visible:ring-2 focus-visible:ring-primary/60"
        :class="[
          node.active ? 'z-20 h-12 w-12 text-xs' : 'z-10 h-10 w-10',
          node.active && 'agent-orbit__node--active',
          node.meta.alarm && 'agent-orbit__node--alarm',
          !node.match && 'opacity-25',
          term && node.match && !node.active && 'agent-orbit__node--match',
        ]"
        :style="{
          left: `${node.x}px`,
          top: `${node.y}px`,
          borderColor: node.meta.color,
          '--node-color': node.meta.color,
          '--node-delay': `${Math.min(index, 24) * 28}ms`,
        }"
        :aria-current="node.active ? 'true' : undefined"
        :aria-label="`${node.agent.name} — ${node.meta.labelKey ? $t(node.meta.labelKey) : node.agent.status}`"
        :title="node.agent.name"
        @click="emit('select', node.id)"
      >
        {{ node.initials }}
        <span
          v-if="node.agent.isAdmin"
          class="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#09070d] bg-primary"
          aria-hidden="true"
        />
        <span
          v-if="node.meta.pulse"
          class="absolute -bottom-1 -right-1 h-2.5 w-2.5 animate-ping rounded-full opacity-70"
          :style="{ background: node.meta.color }"
          aria-hidden="true"
        />
      </button>

      <!-- The label is outside the button so the name never fights the
           initials for the hit area; the button's aria-label carries it. -->
      <span
        class="agent-orbit__label pointer-events-none absolute whitespace-nowrap text-[11.5px] leading-tight transition-opacity duration-300"
        :class="[
          node.active ? 'z-20 font-semibold text-foreground' : 'z-[5] font-medium text-muted-foreground',
          !node.match && 'opacity-20',
          node.labelAlign === 'right' && 'text-right',
          node.labelAlign === 'center' && 'text-center',
        ]"
        :style="{ ...node.labelStyle, '--node-delay': `${Math.min(index, 24) * 28}ms` }"
        aria-hidden="true"
      >
        <span
          class="block overflow-hidden text-ellipsis"
          :class="node.active || (term && node.match) ? 'max-w-[180px]' : 'max-w-[104px]'"
        >
          {{ node.agent.name }}
        </span>
        <span class="block font-mono text-[10px]" :style="{ color: node.meta.color }">
          {{ node.meta.labelKey ? $t(node.meta.labelKey) : node.agent.status }}
        </span>
      </span>
    </template>

    <p
      v-if="hasSearchMiss"
      class="absolute inset-x-0 bottom-3 text-center text-xs text-muted-foreground"
    >
      {{ $t('rail.no_match', { term: search }) }}
    </p>
    <p
      v-else-if="!pending && !nodes.length"
      class="absolute inset-x-0 top-1/2 mt-14 text-center text-xs text-muted-foreground"
    >
      {{ $t('rail.empty') }}
    </p>
  </div>
</template>

<style scoped>
.agent-orbit__hub {
  background: radial-gradient(circle, rgba(245, 161, 107, 0.18), rgba(245, 161, 107, 0) 70%);
}

.agent-orbit__node {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  animation: agent-orbit-in 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  animation-delay: var(--node-delay);
}
.agent-orbit__label {
  animation: agent-orbit-fade 480ms ease-out both;
  animation-delay: calc(var(--node-delay) + 120ms);
}
.agent-orbit__node--active {
  box-shadow:
    0 0 0 4px rgba(245, 161, 107, 0.25),
    0 0 28px rgba(245, 161, 107, 0.55),
    0 6px 18px rgba(0, 0, 0, 0.35);
}
.agent-orbit__node--match {
  box-shadow:
    0 0 0 3px rgba(245, 161, 107, 0.35),
    0 6px 18px rgba(0, 0, 0, 0.35);
}
.agent-orbit__node--alarm {
  animation:
    agent-orbit-in 480ms cubic-bezier(0.2, 0.7, 0.2, 1) both,
    agent-orbit-alarm 2.4s ease-in-out 480ms infinite;
  animation-delay: var(--node-delay), calc(var(--node-delay) + 480ms);
}
.agent-orbit__rings ellipse {
  animation: agent-orbit-dash 90s linear infinite;
}

/* Tailwind's -translate-* classes use the `translate` property, so the
   keyframe may own `transform` without undoing the centring. */
@keyframes agent-orbit-in {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes agent-orbit-fade {
  from {
    opacity: 0;
  }
}
@keyframes agent-orbit-alarm {
  0%,
  100% {
    box-shadow:
      0 0 0 0 rgba(214, 69, 61, 0),
      0 6px 18px rgba(0, 0, 0, 0.35);
  }
  50% {
    box-shadow:
      0 0 0 5px rgba(214, 69, 61, 0.28),
      0 0 22px rgba(214, 69, 61, 0.5),
      0 6px 18px rgba(0, 0, 0, 0.35);
  }
}
@keyframes agent-orbit-dash {
  to {
    stroke-dashoffset: -1000;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-orbit__node,
  .agent-orbit__label,
  .agent-orbit__rings ellipse,
  .agent-orbit__node--alarm {
    animation: none;
  }
}
</style>
