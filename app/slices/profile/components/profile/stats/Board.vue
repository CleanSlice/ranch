<script setup lang="ts">
import type { IStatsBoard } from '#profile/domain';
import { compare } from '#profile/utils/delta';
import { wholeShare } from '#profile/utils/share';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * The scoreboard (CLEAN-258): conversations, the person's own messages, the
 * agents that answered, and the share of questions resolved.
 *
 * The first two are set against the period before; the rule is `compare()`
 * and this only words it. A rise and a fall differ by the arrow and by a word
 * for a screen reader, not by colour alone.
 *
 * The fourth figure is read from conversation summaries (CLEAN-270): the
 * share of the summarised conversations that a summary calls resolved, with
 * its coverage under it, "summary for 8 of 12", because 1 of 1 and 40 of 40
 * are the same percent and not the same news. Without a share the tile
 * holds its place with a dash and says why, and the two reasons are
 * different sentences: the installation produces no summaries
 * (`summariesEnabled` false), or it does and none of the period's
 * conversations has one yet. Which of the three it is stands in
 * `data-stats-summaries` on the tile: `off`, `none` or `share`.
 */
const props = defineProps<{
  board: IStatsBoard;
  /** Whether the installation produces summaries: never read off a zero. */
  summariesEnabled: boolean;
  period: StatsPeriod;
  /** Set when activity is counted from a day inside the period. */
  since: Date | null;
}>();

const format = useFormat();

const conversationsShown = useCountUp(() => props.board.conversations.value);
const messagesShown = useCountUp(() => props.board.messages.value);
const agentsShown = useCountUp(() => props.board.agents.value);

// Null while there is nothing to take a share of, and always with summaries
// off: whatever a count says then, nothing was counted.
const resolvedShare = computed(() =>
  props.summariesEnabled
    ? wholeShare(props.board.resolved.resolved, props.board.resolved.summarised)
    : null,
);
const resolvedPercent = computed(() => Math.round((resolvedShare.value ?? 0) * 100));
const resolvedShown = useCountUp(() => resolvedPercent.value);
const resolvedState = computed(() => {
  if (!props.summariesEnabled) return 'off';
  return resolvedShare.value === null ? 'none' : 'share';
});

// The two figures that have a previous period. The label is a plural without
// its number (the number is the big figure above it), so it is chosen by the
// real value, never by the one still counting up.
const compared = computed(() => [
  {
    key: 'conversations',
    labelKey: 'stats.board.conversations',
    value: props.board.conversations.value,
    shown: conversationsShown.value,
    delta: compare(props.board.conversations.value, props.board.conversations.previous),
  },
  {
    key: 'messages',
    labelKey: 'stats.board.messages',
    value: props.board.messages.value,
    shown: messagesShown.value,
    delta: compare(props.board.messages.value, props.board.messages.previous),
  },
]);
</script>

<template>
  <div class="stats-rise">
    <section class="stats-board" :aria-label="$t('stats.board.label')">
      <div
        v-for="tile in compared"
        :key="tile.key"
        class="stats-board__tile"
        :data-stats-tile="tile.key"
        :data-stats-value="tile.value"
      >
        <div class="stats-board__value">{{ format.number(tile.shown) }}</div>
        <div class="stats-board__label">{{ $t(tile.labelKey, {}, tile.value) }}</div>
        <div
          v-if="tile.delta.kind === 'up' || tile.delta.kind === 'down'"
          class="stats-board__delta"
          :class="`stats-board__delta--${tile.delta.kind}`"
          :data-stats-delta="tile.delta.kind"
        >
          <span aria-hidden="true">{{ tile.delta.kind === 'up' ? '▲' : '▼' }}</span>
          <span class="sr-only">
            {{ tile.delta.kind === 'up' ? $t('stats.board.rise') : $t('stats.board.fall') }}
          </span>
          {{
            $t('stats.board.versus', {
              percent: format.percent(tile.delta.percent / 100),
              count: period,
            })
          }}
        </div>
        <div v-else class="stats-board__delta" :data-stats-delta="tile.delta.kind">
          {{ tile.delta.kind === 'same' ? $t('stats.board.same') : $t('stats.board.no_previous') }}
        </div>
      </div>

      <div
        class="stats-board__tile"
        data-stats-tile="agents"
        :data-stats-value="board.agents.value"
      >
        <div class="stats-board__value">{{ format.number(agentsShown) }}</div>
        <div class="stats-board__label">
          {{ $t('stats.board.agents', {}, board.agents.value) }}
        </div>
        <div class="stats-board__delta">
          {{
            $t(
              'stats.board.of_available',
              { count: format.number(board.agents.reachable) },
              board.agents.reachable,
            )
          }}
        </div>
      </div>

      <div
        class="stats-board__tile"
        data-stats-tile="resolved"
        :data-stats-summaries="resolvedState"
        :data-stats-value="resolvedState === 'share' ? resolvedPercent : undefined"
      >
        <!-- Literal keys in every branch: `i18n:check` reads a key only
             where it is written out. -->
        <template v-if="resolvedState === 'share'">
          <div class="stats-board__value">{{ format.percent(resolvedShown / 100) }}</div>
          <div class="stats-board__label">{{ $t('stats.board.resolved') }}</div>
          <div class="stats-board__delta" data-stats-coverage>
            {{
              $t('stats.summaries.coverage', {
                summarised: format.number(board.resolved.summarised),
                count: format.number(board.conversations.value),
              })
            }}
          </div>
        </template>
        <template v-else>
          <div class="stats-board__value stats-board__value--none" aria-hidden="true">—</div>
          <div class="stats-board__label">{{ $t('stats.board.resolved') }}</div>
          <div class="stats-board__delta">
            {{
              resolvedState === 'off'
                ? $t('stats.summaries.not_produced')
                : $t('stats.summaries.none_yet')
            }}
          </div>
        </template>
      </div>
    </section>

    <p v-if="since" class="stats-hint" data-stats-note>
      {{ $t('stats.state.activity_since', { date: format.dayMonth(since) }) }}
    </p>
  </div>
</template>
