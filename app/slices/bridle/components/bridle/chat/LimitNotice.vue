<script setup lang="ts">
import type { ILimitCountdown } from '#bridle/composables/useLimitCountdown';
import type { ILimitTimeView } from '#bridle/utils/limitTime';
import { useFormat } from '#common/composables/useFormat';

/**
 * The agent has reached its message limit (CLEAN-224,
 * specs/030-agent-request-limits/contracts/chat-notice.md).
 *
 * A state, not an alert: it sits on the top edge of the composer for as long
 * as the limit is full, says when to try again, and leaves by itself. It has
 * no close button on purpose. The text names the agent's limit, never the
 * reader — the limit may have been filled by other people entirely.
 *
 * It only shows what it is handed. The wait lives in the bridle store, the
 * countdown in `useLimitCountdown`, and nothing here sends anything.
 */
const props = defineProps<{
  /** Referenced by `aria-describedby` on every control the limit turns off. */
  id: string;
  countdown: ILimitCountdown;
  /** Set for the length of the nudge after a blocked Enter. */
  nudge?: boolean;
}>();

const format = useFormat();

const waiting = computed(() => props.countdown.state === 'waiting');

/**
 * The sentence for the screen-reader alternative. Copy decided in script
 * travels as a key (docs/i18n.md); the visible line names the same three keys
 * in the template.
 */
function retryKeyOf(view: ILimitTimeView): string {
  switch (view.kind) {
    case 'clock':
      return 'bridle.limit.retryAfter';
    case 'tomorrow':
      return 'bridle.limit.retryTomorrow';
    default:
      return 'bridle.limit.retryIn';
  }
}

/** `0:42` as counted, or the time of day in the reader's language. */
function timeOf(view: ILimitTimeView): string {
  if (view.kind === 'countdown') return view.text;
  if (view.kind === 'clock' || view.kind === 'tomorrow') return format.clock(view.at);
  return '';
}

const timeText = computed(() => timeOf(props.countdown.view));

// ── For someone who cannot see it ──────────────────────────────
// The visible time ticks, so it is hidden from assistive technology; what is
// read instead is the wait as it stood when it began. It changes only when a
// new wait starts (`serial`), so the two lines are heard once — not every
// second — and "You can send your message now." once at the end. Kept as the
// view, not as text, so a language switch still rewrites it.
const spokenView = shallowRef<ILimitTimeView>(props.countdown.view);
watch(
  () => props.countdown.serial,
  () => {
    if (props.countdown.state === 'waiting') spokenView.value = props.countdown.view;
  },
);
const spokenKey = computed(() => retryKeyOf(spokenView.value));
const spokenTime = computed(() => timeOf(spokenView.value));
</script>

<template>
  <!-- data-* are hooks for browser checks; the names are a contract. -->
  <div
    :id="id"
    class="limit-notice relative flex items-start gap-2 overflow-hidden rounded-t-2xl border border-b-0 bg-muted px-3 py-2 text-xs leading-snug text-foreground"
    data-limit-notice
    :data-limit-state="countdown.state"
    :data-limit-window="countdown.window"
    :data-limit-nudge="nudge ? '' : undefined"
  >
    <Icon
      :name="waiting ? 'clock' : 'check'"
      :size="14"
      class="mt-px text-muted-foreground"
      aria-hidden="true"
    />
    <div
      class="limit-notice__text min-w-0 flex-1"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <template v-if="waiting">
        <p class="font-medium">{{ $t('bridle.limit.reached') }}</p>
        {{ ' ' }}
        <p class="text-muted-foreground">
          <!-- i18n-t keeps "Try again in {time}." one translatable sentence
               with the time as a slot — translators reorder words. One
               branch per sentence, each with its key written out, so
               `i18n:check` can see that all three exist. -->
          <i18n-t
            v-if="countdown.view.kind === 'clock'"
            keypath="bridle.limit.retryAfter"
            tag="span"
            aria-hidden="true"
          >
            <template #time>
              <span class="limit-notice__time" :data-limit-time="timeText">{{ timeText }}</span>
            </template>
          </i18n-t>
          <i18n-t
            v-else-if="countdown.view.kind === 'tomorrow'"
            keypath="bridle.limit.retryTomorrow"
            tag="span"
            aria-hidden="true"
          >
            <template #time>
              <span class="limit-notice__time" :data-limit-time="timeText">{{ timeText }}</span>
            </template>
          </i18n-t>
          <i18n-t
            v-else
            keypath="bridle.limit.retryIn"
            tag="span"
            aria-hidden="true"
          >
            <template #time>
              <span class="limit-notice__time" :data-limit-time="timeText">{{ timeText }}</span>
            </template>
          </i18n-t>
          <span class="sr-only">{{ $t(spokenKey, { time: spokenTime }) }}</span>
        </p>
      </template>
      <p v-else class="font-medium">{{ $t('bridle.limit.ready') }}</p>
    </div>

    <!-- The wait, drawn: a thin line that shortens as it runs out. Decoration
         only — the same fact is in the text — and gone for a reader who asked
         for less motion. -->
    <span
      v-if="waiting"
      class="limit-notice__line"
      aria-hidden="true"
      :style="{ transform: `scaleX(${countdown.fraction})` }"
    />
  </div>
</template>

<style scoped>
.limit-notice {
  container-type: inline-size;
}

/* A phone: the two sentences run on as one paragraph, so the notice is never
   taller than two lines and the field below keeps its place. */
@container (max-width: 380px) {
  .limit-notice__text p {
    display: inline;
  }
}

/* Digits of one width, so the sentence does not shiver as they change. */
.limit-notice__time {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--foreground);
}

.limit-notice__line {
  position: absolute;
  inset: auto 0 0 0;
  height: 2px;
  background: color-mix(in oklab, var(--foreground) 35%, transparent);
  transform-origin: left center;
  /* One tick a second, drawn as one continuous movement. */
  transition: transform 1s linear;
}

/* A blocked Enter does not fail silently: the notice answers it. */
.limit-notice[data-limit-nudge] {
  animation: limit-nudge 360ms ease-in-out;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--foreground) 45%, transparent);
}

@keyframes limit-nudge {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-3px);
  }
  75% {
    transform: translateX(3px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .limit-notice__line {
    display: none;
  }
  /* The outline alone says it; nothing moves. */
  .limit-notice[data-limit-nudge] {
    animation: none;
  }
}
</style>
