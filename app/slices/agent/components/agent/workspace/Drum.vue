<script lang="ts">
// Shared by every instance of the drum on purpose: opening an agent replaces
// the page, and with it this component. See `choose` below.
const drumFocus = { keep: false };
</script>

<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import { railOrder } from '#agent/utils/railOrder';
import { agentInitials, agentStatusMeta } from '#agent/utils/agentStatus';

/**
 * The drum: agents as cards standing round a vertical axis, the chosen one
 * facing you at the front. The wheel, a sideways drag or the arrow keys
 * turn it; the drum settles on the nearest card by itself. Turning only
 * chooses — the front card opens on Enter or a click, so scrolling past
 * twenty agents never reloads twenty chats.
 *
 * The cards are a listbox: the container holds focus and names the centred
 * card through aria-activedescendant, so a screen reader hears the choice
 * as it changes, and cards that are round the back are hidden from it.
 */
const props = defineProps<{
  agents: IAgentData[] | null | undefined;
  activeId: string;
  pending: boolean;
  /** Only matching agents stay on the reel; empty keeps all. */
  search: string;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const items = computed(() => {
  const term = props.search.trim().toLowerCase();
  const list = props.agents ?? [];
  return railOrder(
    term ? list.filter((a) => a.name.toLowerCase().includes(term)) : list,
  );
});

/* ── Geometry ──────────────────────────────────────────────────────────── */

const CARD_W = 224;
const CARD_H = 296;
/**
 * A fixed 30° between cards, whatever their number: the drum shows the front
 * card and two to each side, and the rest wait round the back. Angles are
 * never wrapped, so a twentieth card is 570° away, not 150° — it cannot
 * show up on the wrong side.
 */
const STEP_DEG = 30;
const RADIUS = (CARD_W / 2 + 10) / Math.tan((STEP_DEG / 2) * (Math.PI / 180));

/* ── Motion ────────────────────────────────────────────────────────────── */

/** Where the drum is, as a card index; fractional while it turns. */
const position = ref(0);
/** Where it is heading. Integer once the drum has settled. */
const target = ref(0);
const count = computed(() => items.value.length);
const last = computed(() => Math.max(0, count.value - 1));

/**
 * The drum is a loop: past the last card comes the first, in either
 * direction, so nobody has to wind it all the way back. `position` and
 * `target` are then free-running numbers and a card's place is taken modulo
 * the number of cards.
 *
 * Only from seven cards up. The drum shows the front card and three steps to
 * each side; with fewer than seven a card leaving on one side would have to
 * reappear on the other while still in view, which reads as a jump. A short
 * drum keeps its two ends.
 */
const LOOP_FROM = 7;
const loops = computed(() => count.value >= LOOP_FROM);
function mod(value: number, n: number) {
  return ((value % n) + n) % n;
}
/** Signed shortest way round the loop, in cards: -n/2 … n/2. */
function wrap(delta: number) {
  const n = count.value;
  if (!loops.value || n === 0) return delta;
  return mod(delta + n / 2, n) - n / 2;
}
/** The card in front, as an index into `items`. */
const centred = computed(() => {
  const nearest = Math.round(position.value);
  if (!count.value) return 0;
  return loops.value ? mod(nearest, count.value) : nearest;
});

let frame: number | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function tick() {
  frame = null;
  const gap = target.value - position.value;
  if (Math.abs(gap) < 0.002 || reduceMotion) {
    position.value = target.value;
    return;
  }
  position.value += gap * 0.16;
  frame = requestAnimationFrame(tick);
}
function animate() {
  if (frame === null) frame = requestAnimationFrame(tick);
}
/** A looping drum turns freely; a short one stops at its ends. */
function clamp(value: number) {
  if (loops.value) return value;
  return Math.min(last.value, Math.max(0, value));
}
/** Land on the nearest card once the input has paused. */
function settle(delay = 110) {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    target.value = clamp(Math.round(target.value));
    animate();
  }, delay);
}
/** Turn by a number of cards from where the drum is heading. */
function turnBy(cards: number) {
  target.value = clamp(Math.round(target.value) + cards);
  animate();
}
/** Bring one card to the front, the short way round. */
function turnTo(index: number) {
  const from = Math.round(target.value);
  target.value = clamp(from + wrap(index - from));
  animate();
}

function onWheel(event: WheelEvent) {
  // A trackpad swipes sideways, a mouse wheel only has vertical; both turn
  // the drum. 90px is a comfortable notch per card on a wheel and lets the
  // trackpad move fractionally.
  const delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 400 : 1;
  target.value = clamp(target.value + (delta * unit) / 90);
  animate();
  settle();
}

// Drag: the drum follows the pointer card for card, then settles.
let dragStartX: number | null = null;
let dragStartTarget = 0;
let dragged = false;
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragStartX = event.clientX;
  dragStartTarget = target.value;
  dragged = false;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  // The drum is one control: wherever it is pressed, the listbox itself
  // holds the focus, never a card. A focused card travels round the back
  // with the reel and takes the arrow keys with it.
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
}
function onPointerMove(event: PointerEvent) {
  if (dragStartX === null) return;
  const dx = event.clientX - dragStartX;
  if (Math.abs(dx) > 4) dragged = true;
  target.value = clamp(dragStartTarget - dx / CARD_W);
  animate();
}
function onPointerUp() {
  if (dragStartX === null) return;
  dragStartX = null;
  settle(0);
}

function onCardClick(index: number) {
  if (dragged) return;
  if (index === centred.value) {
    const agent = items.value[index];
    if (agent) choose(agent.id);
  } else {
    turnTo(index);
  }
}

/**
 * Opening an agent from the drum must not cost the drum its focus: the
 * arrows should go on turning it. Opening one changes the route, and the
 * page under the new route is a new component instance, so this drum is
 * unmounted and a fresh one mounted with nothing focused. The intent is
 * therefore kept outside the instance (`keepFocus`, module scope) and the
 * next drum to mount, or this one if it survives, takes the focus back.
 */
const rootEl = ref<HTMLElement | null>(null);
function choose(id: string) {
  drumFocus.keep = true;
  emit('select', id);
  // Same agent, no navigation: nothing will remount, restore here.
  void nextTick(restoreFocus);
}
function restoreFocus() {
  if (!drumFocus.keep || !rootEl.value) return;
  if (document.activeElement !== rootEl.value) {
    rootEl.value.focus({ preventScroll: true });
  }
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      turnBy(1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      turnBy(-1);
      break;
    case 'PageDown':
      turnBy(5);
      break;
    case 'PageUp':
      turnBy(-5);
      break;
    case 'Home':
      turnTo(0);
      break;
    case 'End':
      turnTo(last.value);
      break;
    case 'Enter':
    case ' ': {
      const agent = items.value[centred.value];
      if (agent) choose(agent.id);
      break;
    }
    default:
      return;
  }
  event.preventDefault();
}

// Start on the open agent, and come back to it when the route changes under
// us (the rail overlay on a phone, the orbit's hub, a link).
function centreActive() {
  const index = items.value.findIndex((a) => a.id === props.activeId);
  if (index >= 0) {
    // The turn of the loop the drum is already on, so a card that is in
    // front stays put instead of spinning a whole number of laps.
    const from = Math.round(position.value);
    const at = from + wrap(index - from);
    target.value = at;
    position.value = at;
  }
}
watch(
  () => props.activeId,
  () => {
    centreActive();
    void nextTick(restoreFocus);
  },
);
watch(
  () => items.value.length,
  () => {
    target.value = clamp(target.value);
    position.value = clamp(position.value);
  },
);
// A new search term starts the drum at its first match.
watch(
  () => props.search,
  () => {
    turnTo(0);
  },
);
onMounted(() => {
  centreActive();
  // A drum mounted because an agent was just opened from the previous one
  // takes the focus over, then forgets the request: a later visit to the
  // page by any other road must not grab the keyboard.
  restoreFocus();
  drumFocus.keep = false;
});
onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame);
  if (settleTimer) clearTimeout(settleTimer);
});

/* ── Cards ─────────────────────────────────────────────────────────────── */

const cards = computed(() =>
  items.value.map((agent, index) => {
    // On a looping drum the angle is the short way round from the front, so
    // the card after the last one is the first, not one 630° away.
    const angle = wrap(index - position.value) * STEP_DEG;
    const rad = (angle * Math.PI) / 180;
    const visible = Math.abs(angle) < 92;
    const depth = Math.max(0, Math.cos(rad));
    return {
      id: `agent-drum-${agent.id}`,
      agent,
      index,
      visible,
      centre: index === centred.value,
      initials: agentInitials(agent.name, agent.id),
      meta: agentStatusMeta(agent.status),
      style: {
        transform: `rotateY(${angle}deg) translateZ(${RADIUS}px)`,
        opacity: visible ? 0.18 + 0.82 * depth ** 2 : 0,
        zIndex: Math.round(depth * 100),
      },
    };
  }),
);

const centredCard = computed(() => cards.value[centred.value] ?? null);
</script>

<template>
  <div
    ref="rootEl"
    class="agent-drum relative flex h-full w-full select-none items-center justify-center overflow-hidden"
    role="listbox"
    tabindex="0"
    :aria-label="$t('drum.label')"
    :aria-activedescendant="centredCard?.id"
    @keydown="onKeydown"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- The spotlight: where the chosen card comes to rest. -->
    <div
      v-if="items.length"
      class="agent-drum__spot pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[22px]"
      :style="{ width: `${CARD_W + 20}px`, height: `${CARD_H + 20}px` }"
      aria-hidden="true"
    />

    <div
      v-if="items.length"
      class="pointer-events-none absolute left-4 top-2 font-mono text-[11px] text-muted-foreground"
      aria-hidden="true"
    >
      <span class="agent-drum__counter text-2xl text-primary">{{ centred + 1 }}</span>
      <span class="ml-1">/ {{ items.length }}</span>
    </div>

    <div
      v-if="items.length"
      class="agent-drum__reel absolute left-1/2 top-1/2"
      :class="reduceMotion && 'agent-drum__reel--still'"
      :style="{ transform: `rotateX(var(--drum-tilt)) translateZ(${-RADIUS}px)` }"
    >
      <button
        v-for="card in cards"
        :id="card.id"
        :key="card.agent.id"
        type="button"
        role="option"
        tabindex="-1"
        class="agent-drum__card absolute left-1/2 top-1/2 flex flex-col rounded-[18px] border bg-linear-to-b from-[#1f1726] to-[#130e19] p-4 text-left"
        :class="[
          card.centre && 'agent-drum__card--centre',
          !card.visible && 'pointer-events-none',
        ]"
        :style="{
          ...card.style,
          width: `${CARD_W}px`,
          height: `${CARD_H}px`,
          marginLeft: `${-CARD_W / 2}px`,
          marginTop: `${-CARD_H / 2}px`,
        }"
        :aria-selected="card.centre"
        :aria-hidden="!card.visible"
        :aria-current="card.agent.id === activeId ? 'true' : undefined"
        @mousedown.prevent
        @click="onCardClick(card.index)"
      >
        <span class="flex items-start justify-between">
          <span
            class="flex h-14 w-14 items-center justify-center rounded-[16px] border bg-linear-to-br from-[#4a3356] to-[#251b2b] text-base font-semibold text-foreground"
            :style="{ borderColor: card.meta.color }"
          >
            {{ card.initials }}
          </span>
          <span class="flex items-center gap-1.5">
            <span
              v-if="card.agent.isAdmin"
              class="text-primary"
              :title="$t('rail.admin_agent')"
            >
              <Icon name="shield" :size="13" />
            </span>
            <span class="relative flex h-2 w-2">
              <span
                v-if="card.meta.pulse"
                class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                :style="{ background: card.meta.color }"
              />
              <span
                class="relative inline-flex h-2 w-2 rounded-full"
                :style="{ background: card.meta.color }"
              />
            </span>
          </span>
        </span>

        <span class="mt-3 line-clamp-2 text-[15px] font-semibold leading-tight text-foreground">
          {{ card.agent.name }}
        </span>
        <span class="agent-drum__class mt-1 text-[11px] uppercase tracking-[0.08em]" :style="{ color: card.meta.color }">
          {{ card.meta.labelKey ? $t(card.meta.labelKey) : card.agent.status }}
        </span>

        <span class="mt-auto flex flex-col gap-1 font-mono text-[10.5px] text-muted-foreground">
          <span class="truncate" :title="card.agent.templateId">{{ card.agent.templateId }}</span>
          <span>{{ card.agent.resources.cpu }} · {{ card.agent.resources.memory }}</span>
        </span>

        <span
          class="mt-3 inline-flex h-7 items-center justify-center gap-1 rounded-full text-[11px] font-medium transition-opacity"
          :class="[
            card.agent.id === activeId
              ? 'border text-muted-foreground'
              : 'bg-primary text-primary-foreground',
            card.centre ? 'opacity-100' : 'opacity-0',
          ]"
        >
          {{ $t(card.agent.id === activeId ? 'drum.open_now' : 'drum.open') }}
          <Icon v-if="card.agent.id !== activeId" name="corner-down-left" :size="11" />
        </span>
      </button>
    </div>

    <p
      v-if="items.length"
      class="pointer-events-none absolute inset-x-0 bottom-3 text-center font-mono text-[10.5px] text-muted-foreground/70"
      aria-hidden="true"
    >
      {{ $t('drum.hint') }}
    </p>

    <!-- Loading, nothing, or nothing that matches. -->
    <div v-else-if="pending" class="flex gap-3" aria-hidden="true">
      <div
        v-for="i in 3"
        :key="i"
        class="animate-pulse rounded-[18px] bg-muted"
        :class="i === 2 ? 'opacity-100' : 'opacity-40'"
        :style="{ width: `${CARD_W}px`, height: `${CARD_H}px` }"
      />
    </div>
    <p v-else-if="search" class="px-4 text-center text-xs text-muted-foreground">
      {{ $t('rail.no_match', { term: search }) }}
    </p>
    <p v-else class="px-4 text-center text-xs text-muted-foreground">
      {{ $t('rail.empty') }}
    </p>
  </div>
</template>

<style scoped>
.agent-drum {
  /* Seen from slightly above. The reel turns around the X axis by
     --drum-tilt, and the sign matters: a negative angle lifts the far side
     of the ring, so the cards going round the back rise the way the far rim
     of a drum does when you look down on it. A positive angle drops them,
     which is the same drum seen from underneath (it shipped that way first).
     The vanishing point sits above centre for the same reason. */
  --drum-tilt: -8deg;
  perspective: 1200px;
  perspective-origin: 50% 32%;
  outline: none;
  cursor: grab;
  /* The copper glow under the reel is an ellipse whose bottom edge (centre
     62% + radius 40% = 102%, transparent from 70% of the radius = 90%) stays
     inside the pane, so it fades out above the footer row instead of being
     cut by it. The earlier 74% + 46% reached 120% and showed as a hard line. */
  background:
    linear-gradient(90deg, rgba(9, 7, 13, 0.92), transparent 18%, transparent 82%, rgba(9, 7, 13, 0.92)),
    radial-gradient(60% 40% at 50% 62%, rgba(245, 161, 107, 0.12), transparent 70%);
}
.agent-drum:active {
  cursor: grabbing;
}
.agent-drum:focus-visible .agent-drum__spot {
  box-shadow:
    0 0 0 2px rgba(245, 161, 107, 0.6),
    0 0 40px rgba(245, 161, 107, 0.25);
}
.agent-drum__spot {
  border: 1px solid rgba(245, 161, 107, 0.3);
  background: radial-gradient(60% 80% at 50% 100%, rgba(245, 161, 107, 0.14), transparent 70%);
  box-shadow: 0 0 60px rgba(245, 161, 107, 0.12);
}
.agent-drum__counter,
.agent-drum__class {
  font-family: DotGothic16, 'Geist Mono', monospace;
}
/* The reel sits back by its own radius, so the front card is at z = 0 and
   renders at its natural size; the rest recede behind it. */
.agent-drum__reel {
  transform-style: preserve-3d;
}
.agent-drum__card {
  transform-origin: 50% 50%;
  backface-visibility: hidden;
  will-change: transform, opacity;
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  transition: border-color 200ms, box-shadow 200ms;
}
.agent-drum__card--centre {
  border-color: rgba(245, 161, 107, 0.6);
  box-shadow:
    0 0 0 1px rgba(245, 161, 107, 0.25),
    0 18px 50px rgba(0, 0, 0, 0.5);
}
/* With reduced motion the drum jumps instead of easing; the 3D stays, since
   a still cylinder moves nothing. */
.agent-drum__reel--still .agent-drum__card {
  transition: none;
}
</style>
