<script setup lang="ts">
import { relativeTime } from '#agent/utils/relativeTime';
import type { IStatsTopic, StatsOutcomeKind } from '#profile/domain';
import { wholeShare } from '#profile/utils/share';
import type { StatsPeriod } from '#profile/utils/statsView';
import { topicPixels } from '#profile/utils/topicPixels';

/**
 * "Topics and questions" (CLEAN-270): what the period's summarised
 * conversations were about, and for the selected topic the main questions
 * the person asked, who answered, when, and how each ended.
 *
 * Drawn only where the installation has a vocabulary
 * (`summaries.topicsReady`, the owner's decision of 2026-11-28): the
 * provider leaves the block out otherwise, with nothing in its place. "No
 * topics yet" below is for an installation that has topics and a period
 * whose conversations carry none.
 *
 * The order and the cut (eight topics, four questions) are the API's. A
 * topic's bar is scaled to the largest topic; how its pixels are shared
 * between resolved, left open and neither is `utils/topicPixels.ts`. The bar
 * is a picture: the row says its numbers in words to a screen reader and
 * shows them in its detail, on hover and on focus. A touch opens no detail,
 * so the selected topic's line prints the same counts, resolved and left
 * open, beside its conversations: a tap on a row is how a phone reads them.
 * The rows themselves stay as wide as they were.
 *
 * The selected topic is this block's view state, not an entity: it is kept
 * here as an id and goes back to the first topic when the period changes.
 *
 * A topic's label and a question are what a summary worded: shown as
 * received, never translated or re-cased (docs/i18n.md). A label too long
 * for its row is cut with an ellipsis and stands in full in the row's detail
 * and above the questions.
 *
 * A mark on a question never rests on its colour: resolved, open and
 * "unclear" each have their own word and their own icon.
 *
 * Under a list of topics one line says where a topic comes from. How many
 * conversations have a summary, wait for one or are too short for one is
 * said by "How conversations end", which stands on every page that has
 * summaries: this block does not.
 */
const props = defineProps<{
  /** Most conversations first, at most eight. */
  topics: IStatsTopic[];
  /** The period of the view on screen: a new one resets the selection. */
  period: StatsPeriod;
}>();

const format = useFormat();

const chosenId = ref<string | null>(null);
watch(
  () => props.period,
  () => {
    chosenId.value = null;
  },
);

const rows = computed(() => {
  let largest = 0;
  for (const topic of props.topics) {
    if (topic.conversations > largest) largest = topic.conversations;
  }
  return props.topics.map((topic) => {
    // What the summaries could not tell: in neither of the two counts.
    const unknown = Math.max(0, topic.conversations - topic.resolved - topic.open);
    return {
      id: topic.id,
      label: topic.label,
      conversations: topic.conversations,
      pixels: topicPixels(topic, largest),
      // The row in words: one key, with a key of its own for a topic that
      // has conversations the summaries could not tell about.
      countsKey: unknown > 0 ? 'stats.topics.counts_unclear' : 'stats.topics.counts',
      // The same numbers as visible text, for the line of the selected
      // topic: its conversations, how many were resolved (and what share
      // that is), how many were left open, and the unclear ones if any.
      metaKey: unknown > 0 ? 'stats.topics.meta_unclear' : 'stats.topics.meta',
      countsParams: {
        count: format.number(topic.conversations),
        resolved: format.number(topic.resolved),
        open: format.number(topic.open),
        unknown: format.number(unknown),
        percent: format.percent(wholeShare(topic.resolved, topic.conversations) ?? 0),
      },
      unknown,
      questions: topic.questions.map((question, index) => ({
        key: `${question.chatId}:${index}`,
        chatId: question.chatId,
        text: question.question,
        agentName: question.agentName,
        ago: relativeTime(question.at?.toISOString()),
        outcome: question.outcome,
      })),
    };
  });
});

// The chosen topic while it is still in the list, the first one otherwise:
// a topic can leave the top eight between two answers.
const selected = computed(
  () => rows.value.find((row) => row.id === chosenId.value) ?? rows.value[0] ?? null,
);

/** The third kind of pixel is explained only where one is drawn. */
const anyUnclear = computed(() => rows.value.some((row) => row.pixels.unknown > 0));

const MARKS: Record<StatsOutcomeKind, { labelKey: string; icon: string; tone: string }> = {
  resolved: { labelKey: 'stats.topics.question_resolved', icon: 'check', tone: 'good' },
  open: { labelKey: 'stats.topics.question_open', icon: 'circle-dot', tone: 'warn' },
  unknown: {
    labelKey: 'stats.topics.question_unclear',
    icon: 'circle-question-mark',
    tone: 'none',
  },
};
</script>

<template>
  <ProfileStatsCard class="stats-rise" :title="$t('stats.topics.title')">
    <div v-if="selected" class="stats-tp">
      <div class="min-w-0">
        <ul class="stats-tl" :aria-label="$t('stats.topics.list_label')">
          <li v-for="row in rows" :key="row.id">
            <ProfileStatsTip>
              <button
                type="button"
                class="stats-trow"
                :class="row.id === selected.id && 'stats-trow--sel'"
                :aria-pressed="row.id === selected.id"
                :data-stats-topic="row.id"
                :data-stats-selected="row.id === selected.id"
                :data-stats-value="row.conversations"
                @click="chosenId = row.id"
              >
                <span class="stats-trow__name">{{ row.label }}</span>
                <span class="stats-trow__count" aria-hidden="true">
                  {{ format.number(row.conversations) }}
                </span>
                <span class="sr-only">
                  {{ $t(row.countsKey, row.countsParams, row.conversations) }}
                </span>
                <span class="stats-pix" aria-hidden="true">
                  <i v-for="pixel in row.pixels.resolved" :key="`r${pixel}`" />
                  <i v-for="pixel in row.pixels.open" :key="`o${pixel}`" class="stats-pix__open" />
                  <i
                    v-for="pixel in row.pixels.unknown"
                    :key="`u${pixel}`"
                    class="stats-pix__unclear"
                  />
                </span>
              </button>
              <template #tip>
                <b>{{ row.label }}</b>
                <br />
                {{ $t(row.countsKey, row.countsParams, row.conversations) }}
              </template>
            </ProfileStatsTip>
          </li>
        </ul>

        <ul class="stats-lg stats-tl__legend" aria-hidden="true">
          <li><i class="stats-pix__key" />{{ $t('stats.topics.resolved') }}</li>
          <li><i class="stats-pix__key stats-pix__open" />{{ $t('stats.topics.left_open') }}</li>
          <li v-if="anyUnclear">
            <i class="stats-pix__key stats-pix__unclear" />{{ $t('stats.outcome.unclear') }}
          </li>
        </ul>
      </div>

      <section class="stats-qs" :data-stats-topic-detail="selected.id">
        <h3 class="stats-qs__title">{{ selected.label }}</h3>
        <p class="stats-qs__meta" data-stats-topic-counts>
          {{ $t(selected.metaKey, selected.countsParams, selected.conversations) }}
        </p>
        <ul v-if="selected.questions.length" class="stats-qlist">
          <li
            v-for="question in selected.questions"
            :key="question.key"
            class="stats-tq"
            data-stats-question
            :data-stats-outcome="question.outcome"
            :data-chat="question.chatId"
          >
            <span class="stats-tq__text">
              <!-- The question as the summary worded it. -->
              <b>{{ question.text }}</b>
              <small v-if="question.agentName || question.ago">
                {{ question.agentName
                }}<template v-if="question.agentName && question.ago"> · </template
                ><template v-if="question.ago">{{
                  $t(question.ago.key, { count: question.ago.count })
                }}</template>
              </small>
            </span>
            <span class="stats-pill" :class="`stats-pill--${MARKS[question.outcome].tone}`">
              <Icon :name="MARKS[question.outcome].icon" :size="11" aria-hidden="true" />
              {{ $t(MARKS[question.outcome].labelKey) }}
            </span>
          </li>
        </ul>
        <p v-else class="stats-kv" data-stats-questions-none>
          {{ $t('stats.topics.no_questions') }}
        </p>
      </section>
    </div>
    <p v-else class="stats-soft" data-stats-topics-none>{{ $t('stats.topics.none') }}</p>

    <!-- Where a topic comes from, beside a list of them; with no topic the
         block's one line says it. -->
    <template v-if="rows.length" #note>
      <span data-stats-topics-source>{{ $t('stats.topics.source') }}</span>
    </template>
  </ProfileStatsCard>
</template>
