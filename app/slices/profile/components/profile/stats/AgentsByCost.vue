<script setup lang="ts">
import type { IInstallationAgent } from '#profile/domain';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Agents by cost" (CLEAN-265): the agents that reported usage in the period,
 * in the API's order: by estimated cost, then those with no price by tokens.
 *
 * Three kinds of row, and the difference is never left to a number alone:
 *
 * - every model of the agent has a price: a bar, the cost and its share;
 * - some have none (`partial`): the same, with a dashed "+" beside the cost,
 *   which says in its detail that the cost is of the priced models only, as
 *   does the bar's own label;
 * - none has one (`cost` is null): the dashed "no price" mark where the bar
 *   would be, a dash where the money would be, and the tokens. Never a zero:
 *   nobody knows what that agent cost.
 *
 * An agent that no longer exists stays in the period it spent in and is
 * marked "removed" in words. Names of agents and models are shown as
 * received.
 *
 * Under the rows: what 30 days come to at the pace of the period's finished
 * days, and where the prices come from. While no finished day has usage
 * there is no projection, and the line says that instead of a sum.
 */
const props = defineProps<{
  agents: IInstallationAgent[];
  /** USD for 30 days at the period's pace; null while there is none. */
  projection: number | null;
  period: StatsPeriod;
}>();

const format = useFormat();

/** A bar is at least this wide, in percent, so that a small cost is still a bar. */
const BAR_MIN = 2;

const rows = computed(() => {
  let total = 0;
  let most = 0;
  for (const agent of props.agents) {
    if (agent.cost === null) continue;
    total += agent.cost;
    if (agent.cost > most) most = agent.cost;
  }
  return props.agents.map((agent) => ({
    id: agent.agentId,
    name: agent.name,
    model: agent.model,
    removed: agent.removed,
    tokens: agent.tokens,
    calls: agent.calls,
    cost: agent.cost,
    partial: agent.partial,
    // A whole percent of the priced total, as the prototype prints it.
    share:
      agent.cost !== null && total > 0 ? Math.round((100 * agent.cost) / total) / 100 : null,
    // Relative to the most expensive agent, which fills the row.
    bar: agent.cost !== null && most > 0 ? Math.max(BAR_MIN, (100 * agent.cost) / most) : BAR_MIN,
  }));
});
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.cost.title')"
    :caption="$t('stats.cost.caption', { count: period })"
  >
    <ul v-if="rows.length" class="stats-rk" :aria-label="$t('stats.cost.list_label')">
      <li
        v-for="row in rows"
        :key="row.id"
        class="stats-rk__row"
        :data-agent="row.id"
        :data-cost="row.cost === null ? 'none' : row.cost"
        :data-partial="row.partial"
        :data-removed="row.removed"
      >
        <span class="stats-rk__name">
          <span class="stats-rk__title">{{ row.name }}</span>
          <small>
            {{ row.model
            }}<template v-if="row.removed"> · {{ $t('stats.cost.removed') }}</template>
          </small>
        </span>

        <span class="stats-rk__mid">
          <!-- The bar is read out as one sentence per kind of row, each a key
               written out below: `i18n:check` reads a key only where it is
               written out. -->
          <ProfileStatsTip v-if="row.cost !== null">
            <span
              class="stats-rk__bar"
              :style="{ width: `${row.bar}%` }"
              tabindex="0"
              role="img"
              :aria-label="
                row.share === null
                  ? row.partial
                    ? $t('stats.cost.bar_label_partial_no_share', {
                        name: row.name,
                        cost: format.estimate(row.cost),
                      })
                    : $t('stats.cost.bar_label_no_share', {
                        name: row.name,
                        cost: format.estimate(row.cost),
                      })
                  : row.partial
                    ? $t('stats.cost.bar_label_partial', {
                        name: row.name,
                        cost: format.estimate(row.cost),
                        share: format.percent(row.share),
                      })
                    : $t('stats.cost.bar_label', {
                        name: row.name,
                        cost: format.estimate(row.cost),
                        share: format.percent(row.share),
                      })
              "
            />
            <template #tip>
              <b>{{ row.name }}</b>
              <br />
              {{ $t('stats.cost.tokens', { count: format.compact(row.tokens) }, row.tokens) }}
              · {{ $t('stats.cost.calls', { count: format.number(row.calls) }, row.calls) }}
            </template>
          </ProfileStatsTip>
          <span v-else class="stats-noprice" data-stats-no-price>
            {{ $t('stats.cost.no_price') }}
          </span>
        </span>

        <span v-if="row.cost !== null" class="stats-rk__value">
          <b>{{ format.estimate(row.cost) }}</b
          ><ProfileStatsTip v-if="row.partial">
            <span
              class="stats-noprice stats-noprice--plus"
              tabindex="0"
              role="img"
              :aria-label="$t('stats.cost.partial_tip')"
              data-stats-partial
              >+</span
            >
            <template #tip>{{ $t('stats.cost.partial_tip') }}</template>
          </ProfileStatsTip>
          <template v-if="row.share !== null"> · {{ format.percent(row.share) }}</template>
        </span>
        <span v-else class="stats-rk__value">
          <ProfileStatsTip>
            <b
              class="stats-rk__none"
              tabindex="0"
              role="img"
              :aria-label="$t('stats.cost.no_price')"
              data-stats-no-cost
              >—</b
            >
            <template #tip>{{ $t('stats.cost.no_price_tip') }}</template>
          </ProfileStatsTip>
          · {{ $t('stats.cost.tokens', { count: format.compact(row.tokens) }, row.tokens) }}
        </span>
      </li>
    </ul>
    <p v-else class="stats-kv" data-stats-cost-none>
      {{ $t('stats.daily.none', { count: period }) }}
    </p>

    <template #note>
      <!-- Two literal key paths, not one chosen in the tag: `i18n:check`
           reads a key only where it is written out. -->
      <i18n-t scope="global"
        v-if="projection !== null"
        keypath="stats.cost.projection"
        tag="span"
        data-stats-projection
        :data-stats-value="projection"
      >
        <template #amount>
          <b>{{ format.estimate(projection) }}</b>
        </template>
      </i18n-t>
      <template v-else>
        <i18n-t scope="global"
          keypath="stats.cost.projection_none"
          tag="span"
          data-stats-projection
          data-stats-value="none"
        >
          <template #amount>
            <b aria-hidden="true">—</b>
            <span class="sr-only">{{ $t('stats.cost.projection_absent') }}</span>
          </template>
        </i18n-t>
        {{ $t('stats.cost.projection_tip') }}
      </template>
      {{ $t('stats.cost.disclaimer') }}
    </template>
  </ProfileStatsCard>
</template>
