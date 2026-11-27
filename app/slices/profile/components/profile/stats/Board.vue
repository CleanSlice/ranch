<script setup lang="ts">
import type { IStatsBoard } from '#profile/domain';
import { compare } from '#profile/utils/delta';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * The scoreboard (CLEAN-258): conversations, the person's own messages, the
 * agents that answered, and the share of questions resolved.
 *
 * The first two are set against the period before; the rule is `compare()`
 * and this only words it. A rise and a fall differ by the arrow and by a word
 * for a screen reader, not by colour alone.
 *
 * The fourth figure comes from conversation summaries, which this view does
 * not carry yet: the tile holds its place with a dash and says "not counted
 * yet" rather than a number nobody counted. It is marked
 * `data-stats-tile="resolved"`; the summaries view replaces its content.
 */
const props = defineProps<{
  board: IStatsBoard;
  period: StatsPeriod;
  /** Set when activity is counted from a day inside the period. */
  since: Date | null;
}>();

const format = useFormat();

const conversationsShown = useCountUp(() => props.board.conversations.value);
const messagesShown = useCountUp(() => props.board.messages.value);
const agentsShown = useCountUp(() => props.board.agents.value);

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

      <div class="stats-board__tile" data-stats-tile="resolved">
        <div class="stats-board__value stats-board__value--none" aria-hidden="true">—</div>
        <div class="stats-board__label">{{ $t('stats.board.resolved') }}</div>
        <div class="stats-board__delta">{{ $t('stats.board.not_counted') }}</div>
      </div>
    </section>

    <p v-if="since" class="stats-hint" data-stats-note>
      {{ $t('stats.state.activity_since', { date: format.dayMonth(since) }) }}
    </p>
  </div>
</template>
