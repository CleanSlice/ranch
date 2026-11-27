<script setup lang="ts">
import { relativeTime } from '#agent/utils/relativeTime';
import type { IInstallationHealth } from '#profile/domain';
import { spanOf } from '#profile/utils/span';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Health" (CLEAN-265): the period's incidents, and the agents whose limits
 * refused requests.
 *
 * An incident's state is an icon and a word, "open" or "closed", not a colour
 * alone. Its reason is the sender's own text and is shown as received, never
 * translated; so is the agent's name, which is the one it had when the
 * incident opened. When it opened is said relative to now; a closed incident
 * also says how long it lasted.
 *
 * The API lists the newest incidents and says how many the period has: when
 * there are more than are listed, one line says so.
 *
 * Neither list is hidden when it is empty: "no incidents" and "nothing was
 * refused" are answers.
 */
const props = defineProps<{
  health: IInstallationHealth;
  period: StatsPeriod;
  /** Set when refusals are counted from a day inside the period. */
  since: Date | null;
}>();

const format = useFormat();

const incidents = computed(() =>
  props.health.incidents.map((incident) => ({
    number: incident.number,
    agentName: incident.agentName,
    open: incident.open,
    reason: incident.reason,
    ago: relativeTime(incident.openedAt?.toISOString()),
    // An open incident has no end yet, so no duration either.
    span: incident.open ? null : spanOf(incident.openedAt, incident.closedAt),
  })),
);
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.health.title')"
    :caption="$t('stats.health.caption')"
  >
    <ul v-if="incidents.length" class="stats-inc" :aria-label="$t('stats.health.incidents_label')">
      <li
        v-for="incident in incidents"
        :key="incident.number"
        class="stats-inc__row"
        :data-incident="incident.number"
        :data-open="incident.open"
      >
        <span
          class="stats-inc__state"
          :class="incident.open ? 'stats-inc__state--open' : 'stats-inc__state--closed'"
        >
          <Icon :name="incident.open ? 'triangle-alert' : 'check'" :size="13" aria-hidden="true" />
          {{ incident.open ? $t('stats.health.open') : $t('stats.health.closed') }}
        </span>
        <span class="stats-inc__text">
          {{ incident.agentName }}
          <span class="stats-inc__num">#{{ incident.number }}</span>
          <!-- The reason as the server sent it; the words around it are ours. -->
          <small v-if="incident.reason" class="stats-inc__reason" :title="incident.reason">{{
            incident.reason
          }}</small>
          <!-- When, on a line of its own: a long reason is cut at three
               lines and must not take the time with it. -->
          <small v-if="incident.ago || incident.span" class="stats-inc__when">
            <template v-if="incident.ago">{{
              $t(incident.ago.key, { count: incident.ago.count })
            }}</template>
            <template v-if="incident.ago && incident.span"> · </template>
            <template v-if="incident.span">{{
              $t('stats.health.lasted', { span: $t(incident.span.key, incident.span.params) })
            }}</template>
          </small>
        </span>
      </li>
    </ul>
    <div v-else class="stats-inc" data-stats-incidents-none>
      <div class="stats-inc__row">
        <span class="stats-inc__state stats-inc__state--closed">
          <Icon name="check" :size="13" aria-hidden="true" />
        </span>
        <span class="stats-inc__text">{{ $t('stats.health.none', { count: period }) }}</span>
      </div>
    </div>
    <p
      v-if="health.incidentsTotal > incidents.length && incidents.length"
      class="stats-hint"
      data-stats-incidents-more
    >
      {{
        $t('stats.health.more', {
          shown: format.number(incidents.length),
          total: format.number(health.incidentsTotal),
        })
      }}
    </p>

    <h3 class="stats-card__caption stats-sub">{{ $t('stats.health.refusals') }}</h3>
    <template v-if="health.refusals.length">
      <ul class="stats-ref" data-stats-refusals>
        <li
          v-for="row in health.refusals"
          :key="row.agentId"
          class="stats-kv stats-ref__row"
          :data-agent="row.agentId"
          :data-refused="row.refused"
        >
          <span>{{ row.name }}</span>
          <b class="font-mono">{{ format.number(row.refused) }}</b>
        </li>
      </ul>
      <p class="stats-hint">{{ $t('stats.health.refusals_hint') }}</p>
    </template>
    <p v-else class="stats-kv" data-stats-refusals-none>{{ $t('stats.health.refusals_none') }}</p>

    <!-- The day is a UTC day, like every day of this view. -->
    <template v-if="since" #note>
      {{
        $t('stats.health.refusals_since', {
          date: format.dayMonth(since.toISOString().slice(0, 10)),
        })
      }}
    </template>
  </ProfileStatsCard>
</template>
