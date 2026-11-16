import type { MaybeRefOrGetter } from 'vue';
import type { BridleLimitWindows } from '#bridle/domain';
import {
  LIMIT_READY_MS,
  limitFraction,
  limitRemainingMs,
} from '#bridle/utils/limit';
import { limitTimeView, type ILimitTimeView } from '#bridle/utils/limitTime';

/**
 * `waiting` while the agent's limit is full; `ready` for a moment after the
 * wait ends, while the notice says the message can be sent.
 */
export type LimitCountdownStates = 'waiting' | 'ready';

/** What the notice and the controls around it render from. */
export interface ILimitCountdown {
  state: LimitCountdownStates;
  window: BridleLimitWindows;
  /** What to show for the time left — see `limitTimeView`. */
  view: ILimitTimeView;
  /** How much of the wait is still ahead, 1 → 0, for the shrinking line. */
  fraction: number;
  /**
   * Changes when a new wait starts (a first refusal, a refusal again, a new
   * announcement) and stays put while one runs down. What a screen reader is
   * told is tied to it, so it hears the notice once per wait.
   */
  serial: number;
}

/** A tab that slept wakes its timers late; this much late still counts as "on time". */
const EXPIRY_SLACK_MS = 250;
const SECOND_MS = 1000;

/**
 * The remaining wait of one agent's request limit, live (CLEAN-224).
 *
 * The store holds the fact — `limits[agentId].until`, on the monotonic clock —
 * and this turns it into something that moves: once a second while visible,
 * and at once when the tab is looked at again, so a tab left in the
 * background shows the right time and not a clock that stopped. When the wait
 * ends by itself the result stays `ready` for two seconds; when the hub lifts
 * the limit early it goes straight to null — there is nothing to announce to
 * someone who was not going to wait that long anyway. Nothing here sends.
 *
 * Call it once per chat (the Provider does) and hand the result down: the
 * composer remounts on "New chat" and is swapped out during a file drag, and
 * neither should restart the line or lose the `ready` moment.
 */
export function useLimitCountdown(
  agentId: MaybeRefOrGetter<string | null | undefined>,
) {
  const bridleStore = useBridleStore();

  const limit = computed(() => {
    const id = toValue(agentId);
    return id ? bridleStore.limitFor(id) : null;
  });

  const state = ref<LimitCountdownStates | null>(null);
  const limitWindow = ref<BridleLimitWindows>('minute');
  const remainingMs = ref(0);
  /** The wait as this view first saw it — the full length of the line. */
  const totalMs = ref(0);
  /** The wall-clock moment the wait ends, for a time of day. */
  const endsAt = ref(0);
  const serial = ref(0);

  /** The `until` being counted down to; plain, the timers read it. */
  let until = 0;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;

  function stopTick() {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = undefined;
  }

  function stopReady() {
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = undefined;
  }

  function enterReady() {
    stopTick();
    stopReady();
    remainingMs.value = 0;
    state.value = 'ready';
    readyTimer = setTimeout(() => {
      readyTimer = undefined;
      state.value = null;
    }, LIMIT_READY_MS);
  }

  /** Measure, then wake again exactly when the shown second changes. */
  function tick() {
    stopTick();
    const left = Math.max(0, until - performance.now());
    if (left <= 0) {
      enterReady();
      return;
    }
    remainingMs.value = left;
    tickTimer = setTimeout(tick, left % SECOND_MS || SECOND_MS);
  }

  function begin(next: { until: number; window: BridleLimitWindows }) {
    stopReady();
    const left = Math.max(0, next.until - performance.now());
    if (next.until !== until || state.value !== 'waiting') {
      totalMs.value = left;
      serial.value++;
    }
    until = next.until;
    limitWindow.value = next.window;
    endsAt.value = Date.now() + left;
    state.value = 'waiting';
    tick();
  }

  watch(
    limit,
    (next) => {
      if (next && limitRemainingMs(next, performance.now()) > 0) {
        begin(next);
        return;
      }
      stopTick();
      if (state.value !== 'waiting') return;
      // The entry left the store. On time: the wait is over, say so. Early:
      // the limit was raised or removed, and the notice simply leaves.
      if (performance.now() >= until - EXPIRY_SLACK_MS) enterReady();
      else state.value = null;
    },
    { immediate: true },
  );

  /** Back in view: the timers were throttled, so measure again now. */
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (state.value !== 'waiting') return;
    endsAt.value = Date.now() + Math.max(0, until - performance.now());
    tick();
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onScopeDispose(() => {
    stopTick();
    stopReady();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  const countdown = computed<ILimitCountdown | null>(() => {
    if (!state.value) return null;
    return {
      state: state.value,
      window: limitWindow.value,
      // The wall clock is taken as "the end minus what is left", so a time of
      // day does not wobble between two minutes from one tick to the next.
      view: limitTimeView(remainingMs.value, endsAt.value - remainingMs.value),
      fraction: limitFraction(remainingMs.value, totalMs.value),
      serial: serial.value,
    };
  });

  return { countdown };
}
