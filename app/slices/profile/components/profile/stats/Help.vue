<script setup lang="ts">
import { WEB_SOURCE, type IStatsHelp } from '#profile/domain';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "How agents helped you" (CLEAN-258): answers that came with sources, times
 * an agent asked a colleague, and the person's own ratings.
 *
 * A tile with nothing to count still stands, with a zero and a plain
 * sentence of its own: "agents managed on their own" is an answer, an empty
 * tile is a question (spec 038, User Story 5).
 *
 * A knowledge base's and a colleague's name are shown as received. The one
 * name the console words itself is the web: the API calls all web pages
 * together `web`.
 */
const props = defineProps<{
  help: IStatsHelp;
  /** The period's conversations: what "with sources" is counted out of. */
  conversations: number;
  period: StatsPeriod;
  /** Set when ratings, citations or hand-overs are counted from a day inside the period. */
  since: Date | null;
}>();

const format = useFormat();

const firstSource = computed(() => props.help.cited.sources[0] ?? null);
const secondSource = computed(() => props.help.cited.sources[1] ?? null);

const rated = computed(() => props.help.ratings.up + props.help.ratings.down);
// A whole percent of the answers the person rated, as the prototype prints it.
const usefulShare = computed(() =>
  rated.value > 0 ? Math.round((100 * props.help.ratings.up) / rated.value) / 100 : 0,
);
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.help.title')"
    :caption="$t('stats.help.caption', { count: period })"
  >
    <div class="stats-tiles">
      <section class="stats-tile" data-stats-tile="cited">
        <h3 class="stats-tile__head">
          <Icon name="link" :size="14" aria-hidden="true" />
          {{ $t('stats.help.cited') }}
        </h3>
        <p class="stats-tile__value">
          <span aria-hidden="true">
            {{ format.number(help.cited.conversations) }}
            <small>{{ $t('stats.help.cited_of', { count: format.number(conversations) }) }}</small>
          </span>
          <span class="sr-only">
            {{
              $t('stats.help.cited_label', {
                cited: format.number(help.cited.conversations),
                count: format.number(conversations),
              })
            }}
          </span>
        </p>
        <!-- Two literal key paths, not one chosen in the tag: `i18n:check`
             reads a key only where it is written out. -->
        <i18n-t scope="global"
          v-if="firstSource && secondSource"
          keypath="stats.help.cited_top_two"
          tag="p"
          class="stats-tile__text"
        >
          <template #first>
            <b>{{ firstSource.name === WEB_SOURCE ? $t('stats.help.web') : firstSource.name }}</b>
          </template>
          <template #second>
            {{ secondSource.name === WEB_SOURCE ? $t('stats.help.web') : secondSource.name }}
          </template>
        </i18n-t>
        <i18n-t scope="global"
          v-else-if="firstSource"
          keypath="stats.help.cited_top_one"
          tag="p"
          class="stats-tile__text"
        >
          <template #first>
            <b>{{ firstSource.name === WEB_SOURCE ? $t('stats.help.web') : firstSource.name }}</b>
          </template>
        </i18n-t>
        <p v-else class="stats-tile__text">{{ $t('stats.help.cited_none') }}</p>
      </section>

      <section class="stats-tile" data-stats-tile="handovers">
        <h3 class="stats-tile__head">
          <Icon name="share-2" :size="14" aria-hidden="true" />
          {{ $t('stats.help.handovers') }}
        </h3>
        <p class="stats-tile__value">
          {{ format.number(help.handovers.total) }}
          <small>{{ $t('stats.help.times', {}, help.handovers.total) }}</small>
        </p>
        <p v-if="help.handovers.total > 0" class="stats-tile__text">
          {{
            $t('stats.help.handovers_done', {
              answered: format.number(help.handovers.answered),
              count: format.number(help.handovers.total),
            })
          }}
          <i18n-t v-if="help.handovers.topPeer" keypath="stats.help.handovers_top" tag="span">
            <template #name>
              <b>{{ help.handovers.topPeer.name }}</b>
            </template>
          </i18n-t>
        </p>
        <p v-else class="stats-tile__text">{{ $t('stats.help.handovers_none') }}</p>
      </section>

      <section class="stats-tile" data-stats-tile="ratings">
        <h3 class="stats-tile__head">
          <Icon name="thumbs-up" :size="14" aria-hidden="true" />
          {{ $t('stats.help.ratings') }}
        </h3>
        <!-- The thumbs are decoration: each number is said in words too. -->
        <p class="stats-tile__value">
          {{ format.number(help.ratings.up)
          }}<Icon name="thumbs-up" :size="15" aria-hidden="true" /><span class="sr-only">{{
            $t('stats.help.rated_up')
          }},</span>
          {{ format.number(help.ratings.down)
          }}<Icon name="thumbs-down" :size="15" aria-hidden="true" /><span class="sr-only">{{
            $t('stats.help.rated_down')
          }}</span>
        </p>
        <p class="stats-tile__text">
          {{
            rated > 0
              ? $t('stats.help.ratings_share', { percent: format.percent(usefulShare) })
              : $t('stats.help.ratings_none')
          }}
        </p>
      </section>
    </div>

    <template v-if="since" #note>
      {{ $t('stats.state.counted_since', { date: format.dayMonth(since) }) }}
    </template>
  </ProfileStatsCard>
</template>
