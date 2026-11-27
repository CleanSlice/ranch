<script setup lang="ts">
import type { IInstallationBoard } from '#profile/domain';
import { compare } from '#profile/utils/delta';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * The installation's scoreboard (CLEAN-265): tokens in and out, model calls,
 * estimated cost and the people who wrote in a conversation.
 *
 * Calls, cost and people are set against the period before, by the same
 * `compare()` and in the same words as the personal scoreboard. Tokens have
 * no comparison: the line under them says how they split into what was sent
 * to models and what models wrote.
 *
 * The cost is an estimate from the product's own price list and is never
 * printed without its "≈" (`format.estimate`). When a model of the period has
 * no price, the label says the estimate leaves such models out: their tokens
 * are in the first tile and in no sum of money.
 */
const props = defineProps<{
  board: IInstallationBoard;
  period: StatsPeriod;
  /** Set when people are counted from a day inside the period. */
  since: Date | null;
}>();

const format = useFormat();

const tokens = computed(() => props.board.tokens.input + props.board.tokens.output);

const tokensShown = useCountUp(() => tokens.value);
const callsShown = useCountUp(() => props.board.calls.value);
const peopleShown = useCountUp(() => props.board.people.value);

// "51.3" and "M" apart: the unit is set in the label's type, as in the
// prototype, so a long unit ("млн") does not push the figure out of its tile.
const tokenParts = computed(() => format.compactParts(tokensShown.value));

/**
 * From this many characters a figure does not fit its tile at full size
 * ("≈ $1,235" is eight) and is set smaller.
 */
const LONG_FROM = 8;

// The three figures that have a previous period. A label that is a plural
// without its number is chosen by the real value, never by the one still
// counting up; the cost's label is no plural and has no count.
const compared = computed(() => [
  {
    key: 'calls',
    labelKey: 'stats.iboard.calls',
    plural: props.board.calls.value as number | null,
    value: props.board.calls.value,
    text: format.number(callsShown.value),
    delta: compare(props.board.calls.value, props.board.calls.previous),
  },
  {
    key: 'cost',
    labelKey: props.board.cost.unpriced.length
      ? 'stats.iboard.cost_excluding'
      : 'stats.iboard.cost',
    plural: null,
    value: props.board.cost.value,
    // Money does not count up: on its way it would show cents nobody spent.
    text: format.estimate(props.board.cost.value),
    delta: compare(props.board.cost.value, props.board.cost.previous),
  },
  {
    key: 'people',
    labelKey: 'stats.iboard.people',
    plural: props.board.people.value as number | null,
    value: props.board.people.value,
    text: format.number(peopleShown.value),
    delta: compare(props.board.people.value, props.board.people.previous),
  },
]);
</script>

<template>
  <div class="stats-rise">
    <section class="stats-board" :aria-label="$t('stats.iboard.label')">
      <div class="stats-board__tile" data-stats-tile="tokens" :data-stats-value="tokens">
        <div class="stats-board__value">
          {{ tokenParts.value }}<small v-if="tokenParts.unit">&nbsp;{{ tokenParts.unit }}</small>
        </div>
        <div class="stats-board__label">{{ $t('stats.iboard.tokens', {}, tokens) }}</div>
        <div class="stats-board__delta" data-stats-tokens-split>
          {{
            $t('stats.iboard.tokens_split', {
              input: format.compact(board.tokens.input),
              output: format.compact(board.tokens.output),
            })
          }}
        </div>
      </div>

      <div
        v-for="tile in compared"
        :key="tile.key"
        class="stats-board__tile"
        :data-stats-tile="tile.key"
        :data-stats-value="tile.value"
      >
        <div
          class="stats-board__value"
          :class="tile.text.length >= LONG_FROM && 'stats-board__value--long'"
        >
          {{ tile.text }}
        </div>
        <div class="stats-board__label">
          {{ tile.plural === null ? $t(tile.labelKey) : $t(tile.labelKey, {}, tile.plural) }}
        </div>
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
    </section>

    <!-- The day is a UTC day, like every day of this view. -->
    <p v-if="since" class="stats-hint" data-stats-note>
      {{
        $t('stats.installation.activity_since', {
          date: format.dayMonth(since.toISOString().slice(0, 10)),
        })
      }}
    </p>
  </div>
</template>
