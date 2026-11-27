<script setup lang="ts">
import { TooltipProvider } from 'reka-ui';
import type {
  IInstallationStats,
  InstallationNoteFigure,
  IPersonalStats,
  StatsNoteFigure,
} from '#profile/domain';
import { statsLocation, type StatsPeriod, type StatsScope } from '#profile/utils/statsView';

/**
 * The Statistics tab's content (CLEAN-258): asks the store for the view of
 * the scope and period and decides what stands on screen while it comes,
 * when it cannot come, when there is nothing to count, and when it is there.
 *
 * Two scopes, two sets of blocks (CLEAN-265): the person's own figures, and
 * for the owner and administrators the installation's. Which one is asked
 * for is the page's business (`utils/statsView.ts` reads it from the address
 * and never offers the installation to a User); this draws what it is given.
 * Should the API refuse the installation all the same (a role taken away
 * while the page stood open), the store holds no view of it and this says
 * whom the figures are for.
 *
 * The view lives in the store (docs/state.md); this renders it by scope and
 * period and keeps no copy. What it does keep is which period of each scope
 * was last on screen: while another one is on its way, that view stays,
 * dimmed, so the page does not jump to placeholders and back at every switch.
 *
 * Topics, outcomes and open questions are read from conversation summaries
 * (CLEAN-270), which an installation may not produce. The answer says so in
 * `summaries.enabled`, and that field alone decides between the three blocks
 * and the one card that stands in for them. A zero decides nothing: with
 * summaries off every count is zero, and with them on a new account's are
 * zero too, and the two are different pages.
 */
const props = defineProps<{
  scope: StatsScope;
  period: StatsPeriod;
  /** The signed-in person's initials, as the pass shows them. */
  initials: string;
  /**
   * The owner or an administrator, by the rule that offers the scope switch:
   * the "summaries off" card tells them what switches summaries on.
   */
  operator: boolean;
}>();

const store = useProfileStatsStore();
const format = useFormat();

function load() {
  // The viewer's zone goes with every request for their own figures: a
  // person's days are cut on their own clock. The installation's are UTC days
  // and the store leaves the zone out. The store also decides whether a
  // request is needed at all.
  void store.load(props.scope, props.period, format.timeZone());
}
watch(() => [props.scope, props.period] as const, load, { immediate: true });

const status = computed(() => store.statusFor(props.scope, props.period));

// The view asked for, under the scope it belongs to: the two have different
// shapes, so each has its own name from here on. One of them at most is set.
const mine = computed(() =>
  props.scope === 'mine' ? store.viewFor('mine', props.period) : null,
);
const installation = computed(() =>
  props.scope === 'installation' ? store.viewFor('installation', props.period) : null,
);

// The period of each scope whose view was last on screen: keys into the
// store, not copies.
const shownPeriod = ref<Record<StatsScope, StatsPeriod | null>>({
  mine: null,
  installation: null,
});
watch(
  () => mine.value ?? installation.value,
  (answered) => {
    if (answered) shownPeriod.value[props.scope] = props.period;
  },
  { immediate: true },
);

/** What to draw: this period's view, or the one held from the period before. */
const heldMine = computed(() => {
  if (props.scope !== 'mine') return null;
  const period = shownPeriod.value.mine;
  return mine.value ?? (period !== null ? store.viewFor('mine', period) : null);
});
const heldInstallation = computed(() => {
  if (props.scope !== 'installation') return null;
  const period = shownPeriod.value.installation;
  return installation.value ?? (period !== null ? store.viewFor('installation', period) : null);
});

/**
 * Nothing in the period and nothing in the one before: a person who has not
 * started yet. With conversations only in the previous period the blocks are
 * drawn, since "0, down from 12" is a figure.
 */
function isEmpty(stats: IPersonalStats): boolean {
  return stats.board.conversations.value === 0 && stats.board.conversations.previous === 0;
}

/**
 * The same for an installation: no usage, nobody in a conversation, in the
 * period or the one before, and nothing in any list. One incident or one
 * refused request is something to show, and the blocks are drawn for it.
 */
function isInstallationEmpty(stats: IInstallationStats): boolean {
  const { board } = stats;
  return (
    board.tokens.input + board.tokens.output === 0 &&
    board.calls.value === 0 &&
    board.calls.previous === 0 &&
    board.cost.previous === 0 &&
    board.people.value === 0 &&
    board.people.previous === 0 &&
    stats.agents.length === 0 &&
    stats.quality.length === 0 &&
    stats.channels.length === 0 &&
    stats.health.incidentsTotal === 0 &&
    stats.health.refusals.length === 0
  );
}

const state = computed<'loading' | 'ready' | 'failed' | 'empty' | 'forbidden'>(() => {
  if (mine.value) return isEmpty(mine.value) ? 'empty' : 'ready';
  if (installation.value) return isInstallationEmpty(installation.value) ? 'empty' : 'ready';
  if (status.value === 'forbidden') return 'forbidden';
  // A failure with a view of this period still held does not get here: the
  // view stays on screen, and the next opening of the tab asks again.
  return status.value === 'failed' ? 'failed' : 'loading';
});
/** A view of another period standing in for the one on its way. */
const standingIn = computed(
  () => state.value === 'loading' && (heldMine.value ?? heldInstallation.value) !== null,
);

/**
 * Since when a block is counted, when that is inside the period: the latest
 * of its figures' dates, so that the one line is true of every number in the
 * block (spec 038, FR-028).
 */
function since<F extends string>(
  notes: readonly { figure: F; completeSince: Date }[],
  figures: readonly F[],
): Date | null {
  let latest: Date | null = null;
  for (const note of notes) {
    if (!figures.includes(note.figure)) continue;
    if (!latest || note.completeSince > latest) latest = note.completeSince;
  }
  return latest;
}
const ACTIVITY: readonly StatsNoteFigure[] = ['activity'];
const HELP: readonly StatsNoteFigure[] = ['ratings', 'citations', 'handovers'];
// The installation's two. Its activity is people, conversations and
// channels, in three blocks: the line stands once, under the scoreboard.
const INSTALLATION_ACTIVITY: readonly InstallationNoteFigure[] = ['activity'];
const REFUSALS: readonly InstallationNoteFigure[] = ['refusals'];

/** Where the person's own figures of this period are: the way out of a refusal. */
const mineLocation = computed(() =>
  statsLocation({ tab: 'stats', period: props.period, scope: 'mine' }),
);

/**
 * The cards that stand in while the first answer is on its way, at about the
 * height each block has on a wide screen, so that the page does not jump
 * when the blocks arrive. Added up from the blocks' rules in `stats.css`;
 * a block that changes its height changes its number here.
 */
const PLACEHOLDERS: Record<StatsScope, readonly { block: string; height: number }[]> = {
  mine: [
    { block: 'activity', height: 206 },
    { block: 'agents', height: 240 },
    { block: 'models', height: 112 },
    { block: 'help', height: 118 },
  ],
  installation: [
    { block: 'daily', height: 250 },
    { block: 'agents-cost', height: 170 },
    { block: 'health', height: 190 },
    { block: 'channels', height: 44 },
  ],
};
</script>

<template>
  <!-- The detail pop-ups open at once, as in the prototype: they are how a
       mark is read, not a hint that may wait. -->
  <TooltipProvider :delay-duration="80" :skip-delay-duration="300">
    <div
      class="flex min-w-0 flex-col gap-4"
      :data-stats-state="state"
      :data-stats-view="scope"
      :aria-busy="state === 'loading'"
    >
      <!-- Said only while this period has nothing on screen: a view that is
           being refreshed behind itself is not news. -->
      <span class="sr-only" role="status">
        {{ state === 'loading' ? $t('stats.state.loading') : '' }}
      </span>

      <!-- The route refused: not a failure, so no Retry. The way on is the
           person's own figures. -->
      <section v-if="state === 'forbidden'" class="stats-card" role="alert" data-stats-forbidden>
        <div class="stats-empty">
          <div class="stats-empty__icon" aria-hidden="true">
            <Icon name="lock" :size="20" />
          </div>
          <h2 class="stats-empty__title">{{ $t('stats.installation.forbidden_title') }}</h2>
          <p class="stats-empty__text">{{ $t('stats.installation.forbidden_text') }}</p>
          <NuxtLink :to="mineLocation" class="stats-go" data-stats-to-mine>
            <Icon name="chart-column" :size="14" aria-hidden="true" />
            {{ $t('stats.scope.mine') }}
          </NuxtLink>
        </div>
      </section>

      <section v-else-if="state === 'failed'" class="stats-card" role="alert" data-stats-failed>
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

      <template v-else-if="heldMine">
        <ProfileStatsEmpty v-if="isEmpty(heldMine)" />
        <div
          v-else
          class="stats-held flex min-w-0 flex-col gap-4"
          :class="standingIn && 'stats-held--dimmed'"
          :inert="standingIn"
        >
          <ProfileStatsBoard
            :board="heldMine.board"
            :summaries-enabled="heldMine.summaries.enabled"
            :period="heldMine.period"
            :since="since(heldMine.notes, ACTIVITY)"
            data-stats-block="board"
            style="--i: 0"
          />
          <ProfileStatsActivity
            :activity="heldMine.activity"
            :period="heldMine.period"
            data-stats-block="activity"
            style="--i: 1"
          />
          <ProfileStatsAgents
            v-if="heldMine.agents.length"
            :agents="heldMine.agents"
            :summaries-enabled="heldMine.summaries.enabled"
            :period="heldMine.period"
            :initials="initials"
            data-stats-block="agents"
            style="--i: 2"
          />
          <!-- By `summaries.enabled`, never by a zero: three blocks where
               summaries are produced, one card where they are not. -->
          <template v-if="heldMine.summaries.enabled">
            <ProfileStatsTopics
              :topics="heldMine.topics"
              :summaries="heldMine.summaries"
              :conversations="heldMine.board.conversations.value"
              :period="heldMine.period"
              data-stats-block="topics"
              style="--i: 3"
            />
            <!-- Side by side; one under the other under 640 px. "Who answers
                 you" draws nothing when no message has a model, and
                 `.stats-two` then gives the whole row to the card left. -->
            <div class="stats-two">
              <ProfileStatsOutcome
                :outcome="heldMine.outcome"
                data-stats-block="outcome"
                style="--i: 4"
              />
              <ProfileStatsModels
                :models="heldMine.models"
                data-stats-block="models"
                style="--i: 5"
              />
            </div>
            <ProfileStatsOpenQuestions
              :questions="heldMine.openQuestions"
              :summarised="heldMine.summaries.summarised"
              :period="heldMine.period"
              data-stats-block="open-questions"
              style="--i: 6"
            />
          </template>
          <template v-else>
            <ProfileStatsSummariesOff
              :operator="operator"
              data-stats-block="summaries-off"
              style="--i: 3"
            />
            <!-- With no "How conversations end" beside it, it has the row. -->
            <ProfileStatsModels
              :models="heldMine.models"
              data-stats-block="models"
              style="--i: 4"
            />
          </template>
          <ProfileStatsHelp
            :help="heldMine.help"
            :conversations="heldMine.board.conversations.value"
            :period="heldMine.period"
            :since="since(heldMine.notes, HELP)"
            data-stats-block="help"
            :style="{ '--i': heldMine.summaries.enabled ? 7 : 5 }"
          />
        </div>
      </template>

      <template v-else-if="heldInstallation">
        <!-- Said once for the whole view (spec 038, FR-029): its days are UTC
             days. And, for an administrator who reaches only some agents,
             that every figure below is of those agents; for one who reaches
             an agent whose conversations are the Owner's, which figures
             leave those conversations out. -->
        <div class="flex flex-col gap-0.5 text-xs text-[color:var(--stats-dim)]">
          <p data-stats-utc>{{ $t('stats.installation.utc_days') }}</p>
          <p
            v-if="heldInstallation.reach.limited"
            data-stats-reach
            :data-stats-value="heldInstallation.reach.agents"
          >
            {{
              $t(
                'stats.installation.limited',
                { count: format.number(heldInstallation.reach.agents) },
                heldInstallation.reach.agents,
              )
            }}
          </p>
          <!-- Agents whose records are the Owner's alone to read (the Ranch
               assistant): their conversations, their spend and their limit
               refusals are in none of the figures here (CLEAN-268); only
               their incidents are listed, as for any agent the viewer
               reaches. The sentence is the management console's
               `ownerOnlyLeftOutText`, said through i18n (CLEAN-269). The
               names are shown as received and joined by the format module.
               The sentence is for one agent or for several, so the form is
               chosen by 1 or 2 and not by the count: 21 names are several,
               and the count 21 would take the Russian form for one. -->
          <p
            v-if="heldInstallation.reach.ownerOnly.length"
            data-stats-owner-only
            :data-stats-value="heldInstallation.reach.ownerOnly.length"
          >
            {{
              $t(
                'stats.installation.owner_only',
                { names: format.list(heldInstallation.reach.ownerOnly) },
                Math.min(heldInstallation.reach.ownerOnly.length, 2),
              )
            }}
          </p>
        </div>

        <ProfileStatsEmpty v-if="isInstallationEmpty(heldInstallation)" installation />
        <div
          v-else
          class="stats-held flex min-w-0 flex-col gap-4"
          :class="standingIn && 'stats-held--dimmed'"
          :inert="standingIn"
        >
          <ProfileStatsInstallationBoard
            :board="heldInstallation.board"
            :period="heldInstallation.period"
            :since="since(heldInstallation.notes, INSTALLATION_ACTIVITY)"
            data-stats-block="installation-board"
            style="--i: 0"
          />
          <ProfileStatsDaily
            :daily="heldInstallation.daily"
            :models="heldInstallation.models"
            :period="heldInstallation.period"
            data-stats-block="daily"
            style="--i: 1"
          />
          <ProfileStatsAgentsByCost
            :agents="heldInstallation.agents"
            :projection="heldInstallation.projection30d"
            :period="heldInstallation.period"
            data-stats-block="agents-cost"
            style="--i: 2"
          />
          <!-- Side by side; one under the other under 640 px. -->
          <div class="stats-two">
            <ProfileStatsHealth
              :health="heldInstallation.health"
              :period="heldInstallation.period"
              :since="since(heldInstallation.notes, REFUSALS)"
              data-stats-block="health"
              style="--i: 3"
            />
            <ProfileStatsQuality
              :quality="heldInstallation.quality"
              :summaries-enabled="heldInstallation.summaries.enabled"
              :period="heldInstallation.period"
              data-stats-block="quality"
              style="--i: 4"
            />
          </div>
          <ProfileStatsChannels
            :channels="heldInstallation.channels"
            data-stats-block="channels"
            style="--i: 5"
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
        <div v-for="card in PLACEHOLDERS[scope]" :key="card.block" class="stats-card">
          <div class="stats-card__head">
            <div class="stats-skel h-5 w-40 max-w-full" />
          </div>
          <div class="stats-skel" :style="{ height: `${card.height}px` }" />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>
