<script setup lang="ts">
import { agentInitials } from '#agent/utils/agentStatus';
import { relativeTime } from '#agent/utils/relativeTime';
import type { IStatsAgent } from '#profile/domain';
import { wholeShare } from '#profile/utils/share';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Who you talk to" (CLEAN-258): the agents the person wrote to in the
 * period, as an orbit and as a list. Both show the API's ranking, by the
 * person's own messages, and share one selection.
 *
 * The selected agent is this block's view state, not an entity: it is kept
 * here as an id and goes back to the first agent when the period changes.
 *
 * A name or a model too long for its row is cut with an ellipsis; the row's
 * detail, on hover and on focus, has both in full.
 *
 * Where the agent's conversations have summaries (CLEAN-270), the row ends
 * with the share of them a summary calls resolved, on a line of its own:
 * the percent, its word, and of how many, "67% resolved of 3". The
 * prototype printed the bare percent after the conversations, and 1 of 1
 * and 40 of 40 both read 100% there; what the percent is a share of stood
 * only in the row's detail, which a touch never opens. The detail still has
 * it in full ("Resolved: 2 of 3 with a summary"); the line in the row is the
 * shortest that says it, because the row's name gets what the line leaves.
 * An agent with no summarised conversation, and every agent while summaries
 * are off, has none: no share, which is not 0%.
 */
const props = defineProps<{
  /** By the person's messages, most first. */
  agents: IStatsAgent[];
  /** Whether the installation produces summaries: never read off a zero. */
  summariesEnabled: boolean;
  /** The period of the view on screen: a new one resets the selection. */
  period: StatsPeriod;
  /** The signed-in person's initials, for the middle of the orbit. */
  initials: string;
  /** Set when activity is counted from a day inside the period. */
  since?: Date | null;
}>();

const format = useFormat();

const chosenId = ref<string | null>(null);
watch(
  () => props.period,
  () => {
    chosenId.value = null;
  },
);
// The chosen agent while it is still in the list, the first one otherwise:
// an agent can leave the ranking between two answers.
const selectedId = computed(
  () =>
    props.agents.find((agent) => agent.agentId === chosenId.value)?.agentId ??
    props.agents[0]?.agentId ??
    null,
);

// One derivation for both drawings: the orbit and the list read these rows.
const rows = computed(() => {
  let total = 0;
  let most = 0;
  for (const agent of props.agents) {
    total += agent.messages;
    if (agent.messages > most) most = agent.messages;
  }
  return props.agents.map((agent) => ({
    id: agent.agentId,
    name: agent.name,
    // Abbreviated the way an agent is everywhere else in the console.
    initials: agentInitials(agent.name, '?'),
    messages: agent.messages,
    conversations: agent.conversations,
    resolved: agent.resolved,
    summarised: agent.summarised,
    resolvedShare: props.summariesEnabled ? wholeShare(agent.resolved, agent.summarised) : null,
    model: agent.model,
    last: relativeTime(agent.lastMessageAt?.toISOString()),
    // A whole percent, as the prototype prints it.
    share: total > 0 ? Math.round((100 * agent.messages) / total) / 100 : 0,
    // The meter is relative to the agent written to most, which fills it.
    meter: most > 0 ? (100 * agent.messages) / most : 0,
  }));
});
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.agents.title')"
    :caption="$t('stats.agents.caption')"
  >
    <div class="stats-ag">
      <ProfileStatsOrbit
        :agents="rows"
        :selected-id="selectedId"
        :initials="initials"
        @select="chosenId = $event"
      />

      <ul class="stats-alist" :aria-label="$t('stats.agents.list_label')">
        <li v-for="row in rows" :key="row.id">
          <ProfileStatsTip>
            <button
              type="button"
              class="stats-arow"
              :class="row.id === selectedId && 'stats-arow--sel'"
              :aria-pressed="row.id === selectedId"
              :data-agent="row.id"
              @click="chosenId = row.id"
            >
              <span class="stats-av" aria-hidden="true">{{ row.initials }}</span>
              <span class="min-w-0">
                <span class="stats-arow__name">{{ row.name }}</span>
                <!-- The model as received; a missing value leaves its half out. -->
                <span v-if="row.model || row.last" class="stats-arow__meta">
                  {{ row.model
                  }}<template v-if="row.model && row.last"> · </template
                  ><template v-if="row.last">{{
                    $t(row.last.key, { count: row.last.count })
                  }}</template>
                </span>
                <span class="stats-meter" aria-hidden="true">
                  <i :style="{ width: `${row.meter}%` }" />
                </span>
              </span>
              <span class="stats-arow__count">
                <b>{{ format.number(row.messages) }}</b>
                {{ $t('stats.agents.messages', {}, row.messages) }}
                <br />
                {{
                  $t(
                    'stats.agents.conversations',
                    { count: format.number(row.conversations) },
                    row.conversations,
                  )
                }}
                <template v-if="row.resolvedShare !== null">
                  <br />
                  <span
                    data-stats-resolved-share
                    :data-stats-value="Math.round(row.resolvedShare * 100)"
                    :data-stats-of="row.summarised"
                  >
                    {{
                      $t('stats.agents.resolved_share', {
                        percent: format.percent(row.resolvedShare),
                        count: format.number(row.summarised),
                      })
                    }}
                  </span>
                </template>
              </span>
            </button>
            <template #tip>
              <b>{{ row.name }}</b>
              <template v-if="row.model">
                <br />
                {{ row.model }}
              </template>
              <br />
              {{
                $t(
                  'stats.agents.messages_count',
                  { count: format.number(row.messages) },
                  row.messages,
                )
              }}
              · {{ format.percent(row.share) }}
              <template v-if="row.resolvedShare !== null">
                <br />
                {{
                  $t('stats.agents.resolved_of', {
                    resolved: format.number(row.resolved),
                    count: format.number(row.summarised),
                  })
                }}
              </template>
            </template>
          </ProfileStatsTip>
        </li>
      </ul>
    </div>

    <template v-if="since" #note>
      {{ $t('stats.state.counted_since', { date: format.dayMonth(since) }) }}
    </template>
  </ProfileStatsCard>
</template>
