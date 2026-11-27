<script setup lang="ts">
import { TooltipProvider } from 'reka-ui';
import type { IPersonalStats, StatsNoteFigure } from '#profile/domain';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * The Statistics tab's content (CLEAN-258): asks the store for the person's
 * view of the period and decides what stands on screen while it comes, when
 * it cannot come, when there is nothing to count, and when it is there.
 *
 * The view lives in the store (docs/state.md); this renders it by scope and
 * period and keeps no copy. What it does keep is which period was last on
 * screen: while another one is on its way, that view stays, dimmed, so the
 * page does not jump to placeholders and back at every switch.
 *
 * Only the person's own scope exists here. The installation's blocks join
 * with their own view.
 */
const props = defineProps<{
  period: StatsPeriod;
  /** The signed-in person's initials, as the pass shows them. */
  initials: string;
}>();

const SCOPE = 'mine' as const;

const store = useProfileStatsStore();
const format = useFormat();

function load() {
  // The viewer's zone goes with every request: a person's days are cut on
  // their own clock. The store decides whether a request is needed at all.
  void store.load(SCOPE, props.period, format.timeZone());
}
watch(() => props.period, load, { immediate: true });

const view = computed(() => store.viewFor(SCOPE, props.period));
const status = computed(() => store.statusFor(SCOPE, props.period));

// The period whose view was last on screen: a key into the store, not a copy.
const shownPeriod = ref<StatsPeriod | null>(null);
watch(
  view,
  (answered) => {
    if (answered) shownPeriod.value = props.period;
  },
  { immediate: true },
);
/** What to draw: this period's view, or the one held from the period before. */
const held = computed(
  () => view.value ?? (shownPeriod.value !== null ? store.viewFor(SCOPE, shownPeriod.value) : null),
);

/**
 * Nothing in the period and nothing in the one before: a person who has not
 * started yet. With conversations only in the previous period the blocks are
 * drawn, since "0, down from 12" is a figure.
 */
function isEmpty(stats: IPersonalStats): boolean {
  return stats.board.conversations.value === 0 && stats.board.conversations.previous === 0;
}

const state = computed<'loading' | 'ready' | 'failed' | 'empty'>(() => {
  if (view.value) return isEmpty(view.value) ? 'empty' : 'ready';
  // A failure with a view of this period still held does not get here: the
  // view stays on screen, and the next opening of the tab asks again.
  return status.value === 'failed' ? 'failed' : 'loading';
});
/** A view of another period standing in for the one on its way. */
const standingIn = computed(() => state.value === 'loading' && held.value !== null);

/**
 * Since when a block is counted, when that is inside the period: the latest
 * of its figures' dates, so that the one line is true of every number in the
 * block (spec 038, FR-028).
 */
function since(stats: IPersonalStats, figures: readonly StatsNoteFigure[]): Date | null {
  let latest: Date | null = null;
  for (const note of stats.notes) {
    if (!figures.includes(note.figure)) continue;
    if (!latest || note.completeSince > latest) latest = note.completeSince;
  }
  return latest;
}
const ACTIVITY: readonly StatsNoteFigure[] = ['activity'];
const HELP: readonly StatsNoteFigure[] = ['ratings', 'citations', 'handovers'];

/**
 * The cards that stand in while the first answer is on its way, at about the
 * height each block has on a wide screen, so that the page does not jump
 * when the blocks arrive. Added up from the blocks' rules in `stats.css`;
 * a block that changes its height changes its number here.
 */
const PLACEHOLDERS = [
  { block: 'activity', height: 206 },
  { block: 'agents', height: 240 },
  { block: 'models', height: 112 },
  { block: 'help', height: 118 },
] as const;
</script>

<template>
  <!-- The detail pop-ups open at once, as in the prototype: they are how a
       mark is read, not a hint that may wait. -->
  <TooltipProvider :delay-duration="80" :skip-delay-duration="300">
    <div
      class="flex min-w-0 flex-col gap-4"
      :data-stats-state="state"
      :aria-busy="state === 'loading'"
    >
      <!-- Said only while this period has nothing on screen: a view that is
           being refreshed behind itself is not news. -->
      <span class="sr-only" role="status">
        {{ state === 'loading' ? $t('stats.state.loading') : '' }}
      </span>

      <section v-if="state === 'failed'" class="stats-card" role="alert" data-stats-failed>
        <div class="stats-empty">
          <div class="stats-empty__icon" aria-hidden="true">
            <Icon name="triangle-alert" :size="20" />
          </div>
          <h2 class="stats-empty__title">{{ $t('stats.state.failed_title') }}</h2>
          <p class="stats-empty__text">{{ $t('stats.state.failed_text') }}</p>
          <button type="button" class="stats-go" data-stats-retry @click="load">
            <Icon name="rotate-cw" :size="14" aria-hidden="true" />
            {{ $t('stats.state.retry') }}
          </button>
        </div>
      </section>

      <template v-else-if="held">
        <ProfileStatsEmpty v-if="isEmpty(held)" />
        <div
          v-else
          class="stats-held flex min-w-0 flex-col gap-4"
          :class="standingIn && 'stats-held--dimmed'"
          :inert="standingIn"
        >
          <ProfileStatsBoard
            :board="held.board"
            :period="held.period"
            :since="since(held, ACTIVITY)"
            data-stats-block="board"
            style="--i: 0"
          />
          <ProfileStatsActivity
            :activity="held.activity"
            :period="held.period"
            data-stats-block="activity"
            style="--i: 1"
          />
          <ProfileStatsAgents
            v-if="held.agents.length"
            :agents="held.agents"
            :period="held.period"
            :initials="initials"
            data-stats-block="agents"
            style="--i: 2"
          />
          <!-- Beside "How conversations end" once summaries are shown; until
               then it has the row to itself. -->
          <ProfileStatsModels :models="held.models" data-stats-block="models" style="--i: 3" />
          <ProfileStatsHelp
            :help="held.help"
            :conversations="held.board.conversations.value"
            :period="held.period"
            :since="since(held, HELP)"
            data-stats-block="help"
            style="--i: 4"
          />
        </div>
      </template>

      <div v-else class="flex min-w-0 flex-col gap-4" aria-hidden="true" data-stats-placeholder>
        <div class="stats-board">
          <div v-for="tile in 4" :key="tile" class="stats-board__tile">
            <div class="stats-skel h-8 w-16" />
            <div class="stats-skel mt-2 h-4 w-24 max-w-full" />
            <div class="stats-skel mt-1.5 h-3.5 w-32 max-w-full" />
          </div>
        </div>
        <div v-for="card in PLACEHOLDERS" :key="card.block" class="stats-card">
          <div class="stats-card__head">
            <div class="stats-skel h-5 w-40 max-w-full" />
          </div>
          <div class="stats-skel" :style="{ height: `${card.height}px` }" />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>
