<script setup lang="ts">
import type { IInstallationQuality } from '#profile/domain';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Where people are unhappy" (CLEAN-265): per agent, the conversations a
 * person wrote in, the share left open, and the share of its rated answers
 * that got a thumbs down.
 *
 * The share left open is read from conversation summaries, which this view
 * does not carry yet: the column holds its place with a dash in every row,
 * read out as "not counted yet" in the words of the personal scoreboard's
 * fourth tile, and one line under the table says so for everybody, rather
 * than a number nobody counted.
 *
 * The thumbs-down share is out of the answers that were rated at all, and
 * the row says of how many: 1 of 2 and 50 of 100 are the same percent and
 * not the same news. An agent nobody rated has a dash, not 0%.
 *
 * The highest share of the column is marked: by colour, by an icon, and by
 * words for a screen reader. Equal highest shares are all marked. The order
 * of the rows is the API's, most conversations first. An agent's name is
 * shown as received.
 */
const props = defineProps<{
  quality: IInstallationQuality[];
  period: StatsPeriod;
}>();

const format = useFormat();

const rows = computed(() => {
  const shares = props.quality.map((row) =>
    // A whole percent, as the prototype prints it.
    row.rated > 0 ? Math.round((100 * row.down) / row.rated) / 100 : null,
  );
  let worst = 0;
  for (const share of shares) {
    if (share !== null && share > worst) worst = share;
  }
  return props.quality.map((row, index) => {
    const share = shares[index] ?? null;
    return {
      id: row.agentId,
      name: row.name,
      conversations: row.conversations,
      down: row.down,
      rated: row.rated,
      share,
      // Nothing is "the worst" while every share is zero.
      worst: share !== null && worst > 0 && share === worst,
    };
  });
});
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
            :data-worst="row.worst"
          >
            <th scope="row">{{ row.name }}</th>
            <td class="stats-table__num">{{ format.number(row.conversations) }}</td>
            <td class="stats-table__num stats-q__pending" data-stats-open-share>
              <span aria-hidden="true">—</span>
              <span class="sr-only">{{ $t('stats.board.not_counted') }}</span>
            </td>
            <td
              class="stats-table__num"
              :class="row.worst && 'stats-q__hot'"
              data-stats-down-share
            >
              <template v-if="row.share !== null">
                <Icon v-if="row.worst" name="triangle-alert" :size="11" aria-hidden="true" />
                {{ format.percent(row.share) }}
                <span v-if="row.worst" class="sr-only">{{ $t('stats.quality.worst') }}</span>
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
           words broke over three lines in every row. -->
      <p class="stats-hint" data-stats-open-pending>{{ $t('stats.quality.open_pending') }}</p>
    </div>
    <p v-else class="stats-kv" data-stats-quality-none>
      {{ $t('stats.quality.none', { count: period }) }}
    </p>
  </ProfileStatsCard>
</template>
