<script setup lang="ts">
import type { IInstallationQuality } from '#profile/domain';
import { anyWithoutSummary, qualityRows } from '#profile/utils/qualityRows';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Where people are unhappy" (CLEAN-265): per agent, the conversations a
 * person wrote in, the share left open, and the share of its rated answers
 * that got a thumbs down.
 *
 * Both shares say of how many: 1 of 2 and 50 of 100 are the same percent
 * and not the same news. The thumbs-down share is out of the answers that
 * were rated at all; an agent nobody rated has a dash, not 0%.
 *
 * The share left open is read from conversation summaries (CLEAN-270): the
 * summarised conversations of the agent that a summary calls left open, out
 * of the summarised. Its cell is one of three things, and `utils/qualityRows.ts`
 * says which: the share; a dash, read out as "no summaries yet", for an
 * agent none of whose conversations has a summary; or, on an installation
 * that produces no summaries, a dash in every row and one line under the
 * table that says so and what switches them on. That line ends with the
 * sentence the "summaries off" card has for operators (`SummariesHow.vue`),
 * and only operators see this view. Which it is, is `summariesEnabled`,
 * never a zero.
 *
 * A dash is never left to a screen reader alone: a phone shows no detail on
 * hover. With summaries on, as soon as one row has a dash for want of a
 * summary, one line under the table says what that dash means.
 *
 * The highest share of each column is marked: by colour, by an icon, and by
 * words for a screen reader. Equal highest shares are all marked, and
 * nothing is while every share is zero. A share of fewer than three
 * (summarised conversations, rated answers) keeps its percent and its
 * "N of M" and is not compared: 1 of 1 is not the highest above 60 of 100.
 * With summaries on, the rows stand by the share left open, highest first,
 * as in the prototype, and after them the rows whose share is not compared,
 * by conversations; with them off, in the API's order, most conversations
 * first. An agent's name is shown as received.
 */
const props = defineProps<{
  quality: IInstallationQuality[];
  /** Whether the installation produces conversation summaries. */
  summariesEnabled: boolean;
  period: StatsPeriod;
}>();

const format = useFormat();

const rows = computed(() => qualityRows(props.quality, props.summariesEnabled));
/** A dash that stands for "no summary yet" is in the table: say so under it. */
const withoutSummary = computed(() => anyWithoutSummary(rows.value));
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.quality.title')"
    :caption="$t('stats.quality.caption')"
  >
    <div v-if="rows.length" class="stats-qwrap">
      <table class="stats-table stats-q">
        <caption class="sr-only">{{ $t('stats.quality.table_label') }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ $t('stats.quality.agent') }}</th>
            <th scope="col" class="stats-table__num">{{ $t('stats.quality.conversations') }}</th>
            <th scope="col" class="stats-table__num">{{ $t('stats.quality.open') }}</th>
            <th scope="col" class="stats-table__num">
              <Icon name="thumbs-down" :size="13" aria-hidden="true" />
              <span class="sr-only">{{ $t('stats.quality.down') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :data-agent="row.id"
            :data-conversations="row.conversations"
            :data-worst="row.worstDown"
            :data-worst-open="row.worstOpen"
          >
            <th scope="row">{{ row.name }}</th>
            <td class="stats-table__num">{{ format.number(row.conversations) }}</td>
            <td
              class="stats-table__num"
              :class="[row.worstOpen && 'stats-q__hot', row.openShare === null && 'stats-q__pending']"
              data-stats-open-share
              :data-stats-state="row.openState"
              :data-stats-value="
                row.openShare !== null ? Math.round(row.openShare * 100) : undefined
              "
            >
              <template v-if="row.openShare !== null">
                <Icon v-if="row.worstOpen" name="triangle-alert" :size="11" aria-hidden="true" />
                {{ format.percent(row.openShare) }}
                <span v-if="row.worstOpen" class="sr-only">{{ $t('stats.quality.worst') }}</span>
                <small>
                  {{
                    $t('stats.quality.open_of', {
                      open: format.number(row.open),
                      count: format.number(row.summarised),
                    })
                  }}
                </small>
              </template>
              <template v-else>
                <span aria-hidden="true">—</span>
                <!-- Literal keys in both branches: `i18n:check` reads a key
                     only where it is written out. -->
                <span class="sr-only">
                  {{
                    row.openState === 'off'
                      ? $t('stats.summaries.not_produced')
                      : $t('stats.summaries.none_yet')
                  }}
                </span>
              </template>
            </td>
            <td
              class="stats-table__num"
              :class="row.worstDown && 'stats-q__hot'"
              data-stats-down-share
            >
              <template v-if="row.downShare !== null">
                <Icon v-if="row.worstDown" name="triangle-alert" :size="11" aria-hidden="true" />
                {{ format.percent(row.downShare) }}
                <span v-if="row.worstDown" class="sr-only">{{ $t('stats.quality.worst') }}</span>
                <small>
                  {{
                    $t('stats.quality.down_of', {
                      down: format.number(row.down),
                      count: format.number(row.rated),
                    })
                  }}
                </small>
              </template>
              <template v-else>
                <span aria-hidden="true">—</span>
                <span class="sr-only">{{ $t('stats.quality.no_ratings') }}</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <!-- Said once under the table: in a cell of a narrow column the same
           words broke over three lines in every row. With summaries on, the
           line is for the dash of an agent that has no summary yet. -->
      <p v-if="!summariesEnabled" class="stats-hint" data-stats-open-off>
        {{ $t('stats.quality.open_off') }}
        <ProfileStatsSummariesHow />
      </p>
      <p v-else-if="withoutSummary" class="stats-hint" data-stats-open-unsummarised>
        {{ $t('stats.quality.open_none') }}
      </p>
    </div>
    <p v-else class="stats-kv" data-stats-quality-none>
      {{ $t('stats.quality.none', { count: period }) }}
    </p>
  </ProfileStatsCard>
</template>
