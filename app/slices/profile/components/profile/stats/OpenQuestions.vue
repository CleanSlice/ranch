<script setup lang="ts">
import { agentInitials } from '#agent/utils/agentStatus';
import { panelLocation } from '#agent/utils/panelView';
import { relativeTime } from '#agent/utils/relativeTime';
import type { IStatsOpenQuestions } from '#profile/domain';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Open questions" (CLEAN-270): the period's conversations that a summary
 * calls left open, the newest four, each with a way back into it.
 *
 * "Continue" is a link, not a button with a handler: it leads to the agent's
 * page on that conversation in its history, the address the agent slice
 * builds for it (`panelLocation`). It opens in the same tab, as a link
 * inside the console does, and like any link it can be opened in a new one
 * or copied. An agent that came without a name is not left as a gap in the
 * link's name or in its detail: both then speak of the conversation.
 *
 * A conversation can be open without a quoted question (`question: null`).
 * It is listed all the same, under a neutral line of the console's own, and
 * still offers Continue: the conversation is what is open, not the wording.
 * A question, a topic and an agent's name are shown as received.
 *
 * With nothing listed there are two different things to say, told apart by
 * whether anything has a summary: "no open questions" is a finding and gets
 * its check mark; "nothing summarised yet" is not one and gets none.
 *
 * And a third: open conversations, none of which can be listed (the answer
 * named no conversation or no agent for them, and the mapper counts those
 * under `more`). The card then says how many there are and where they can
 * be found, in place of the list; "N more" under nothing would say more
 * than what.
 */
const props = defineProps<{
  questions: IStatsOpenQuestions;
  /** Conversations of the period that have a summary. */
  summarised: number;
  period: StatsPeriod;
}>();

const format = useFormat();

const rows = computed(() =>
  props.questions.items.map((item) => ({
    chatId: item.chatId,
    agentId: item.agentId,
    agentName: item.agentName,
    // Abbreviated the way an agent is everywhere else in the console.
    initials: agentInitials(item.agentName, '?'),
    question: item.question,
    topic: item.topic,
    ago: relativeTime(item.at?.toISOString()),
    to: panelLocation(item.agentId, { kind: 'conversation', chatId: item.chatId }),
  })),
);
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.open_questions.title')"
    :caption="rows.length ? $t('stats.open_questions.caption') : undefined"
    :data-stats-open="rows.length + questions.more"
  >
    <ul v-if="rows.length" class="stats-oq">
      <li
        v-for="row in rows"
        :key="row.chatId"
        class="stats-oq__row"
        data-stats-open-question
        :data-chat="row.chatId"
        :data-agent="row.agentId"
        :data-stats-quoted="row.question !== null"
      >
        <span class="stats-av" aria-hidden="true">{{ row.initials }}</span>
        <span class="stats-oq__text">
          <!-- The question as the summary worded it, whole in the title of
               the element when it is cut; the placeholder is the console's. -->
          <b v-if="row.question !== null" :title="row.question">{{ row.question }}</b>
          <b v-else class="stats-oq__unquoted">{{ $t('stats.open_questions.no_question') }}</b>
          <small>
            {{ row.agentName }}<template v-if="row.topic"> · {{ row.topic }}</template
            ><template v-if="row.ago">
              · {{ $t(row.ago.key, { count: row.ago.count }) }}</template
            >
          </small>
        </span>
        <!-- Literal keys in both branches of the link's name and of its
             detail: `i18n:check` reads a key only where it is written out. -->
        <ProfileStatsTip>
          <NuxtLink
            :to="row.to"
            class="stats-go"
            :aria-label="
              row.agentName
                ? $t('stats.open_questions.continue_label', { name: row.agentName })
                : $t('stats.open_questions.continue_label_unnamed')
            "
            data-stats-continue
          >
            {{ $t('stats.open_questions.continue') }}
            <Icon name="arrow-right" :size="13" aria-hidden="true" />
          </NuxtLink>
          <template #tip>
            {{
              row.agentName
                ? $t('stats.open_questions.continue_tip', { name: row.agentName })
                : $t('stats.open_questions.continue_tip_unnamed')
            }}
          </template>
        </ProfileStatsTip>
      </li>
    </ul>
    <p
      v-else-if="questions.more > 0"
      class="stats-soft"
      data-stats-open-none="unlisted"
      :data-stats-value="questions.more"
    >
      {{
        $t(
          'stats.open_questions.unlisted',
          { count: format.number(questions.more) },
          questions.more,
        )
      }}
    </p>
    <template v-else>
      <p v-if="summarised > 0" class="stats-soft stats-soft--line" data-stats-open-none="none">
        <Icon name="check" :size="14" aria-hidden="true" />
        {{ $t('stats.open_questions.none', { count: period }) }}
      </p>
      <p v-else class="stats-soft" data-stats-open-none="pending">
        {{ $t('stats.open_questions.none_yet') }}
      </p>
    </template>

    <!-- "N more" is said of a list: with none, the card's sentence has the
         count. -->
    <template v-if="rows.length && questions.more > 0" #note>
      <span data-stats-open-more :data-stats-value="questions.more">
        {{
          $t(
            'stats.open_questions.more',
            { count: format.number(questions.more) },
            questions.more,
          )
        }}
      </span>
    </template>
  </ProfileStatsCard>
</template>
