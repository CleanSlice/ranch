<script setup lang="ts">
import { STATS_TONES, type IStatsOutcome, type StatsTone } from '#profile/domain';
import { wholeShare } from '#profile/utils/share';
import { OUTCOME_LABEL_MIN_PERCENT, stackSegments } from '#profile/utils/stackSegments';

/**
 * "How conversations end" (CLEAN-270): the period's conversations as parts
 * of a whole (resolved, left open, unclear, without a summary), the tone of
 * the summarised ones, and the languages they were written in.
 *
 * "Unclear" is a part of its own and not a kind of "open": the summary could
 * not tell (`unknown`). It is drawn only above zero, hatched, so that it is
 * told from "no summary" beside it by more than a shade of grey. No part
 * rests on its colour: the bar's label reads every part with its share, each
 * segment shows its detail on hover and on focus, and the legend under the
 * bar has the names and the counts.
 *
 * Tones and languages are of the summarised conversations only. While none
 * of the period's conversations has a summary they are left out, and a line
 * says so, rather than four zeros that read as "nobody was calm".
 *
 * A language is named by the format module in the console's language; a
 * code it does not know is shown as received.
 */
const props = defineProps<{ outcome: IStatsOutcome }>();

const format = useFormat();

const PARTS = [
  { key: 'resolved', labelKey: 'stats.outcome.resolved', color: 'var(--good)', light: false },
  { key: 'open', labelKey: 'stats.outcome.open', color: 'var(--warn)', light: false },
  { key: 'unknown', labelKey: 'stats.outcome.unclear', color: 'var(--unclear)', light: true },
  {
    key: 'notSummarised',
    labelKey: 'stats.outcome.no_summary',
    color: 'var(--none)',
    light: true,
  },
] as const;

/** Resolved and open are always in the legend; the other two only above zero. */
const ALWAYS_NAMED: readonly string[] = ['resolved', 'open'];

const segments = computed(() => {
  const parts = stackSegments(
    PARTS.map((part) => ({ key: part.key, value: props.outcome[part.key] })),
    OUTCOME_LABEL_MIN_PERCENT,
  );
  const drawn = [];
  for (const part of parts) {
    const look = PARTS.find((candidate) => candidate.key === part.key);
    if (!look) continue;
    drawn.push({
      key: part.key,
      label: '',
      labelKey: look.labelKey,
      value: part.value,
      percent: part.percent,
      showLabel: part.label,
      color: look.color,
      light: look.light,
    });
  }
  return drawn;
});

const legend = computed(() =>
  PARTS.filter((part) => ALWAYS_NAMED.includes(part.key) || props.outcome[part.key] > 0).map(
    (part) => ({ ...part, value: props.outcome[part.key] }),
  ),
);

/** Conversations with a summary: what tones and languages are counted among. */
const summarised = computed(
  () => props.outcome.resolved + props.outcome.open + props.outcome.unknown,
);

const TONE_KEYS: Record<StatsTone, string> = {
  positive: 'stats.outcome.tone_positive',
  neutral: 'stats.outcome.tone_neutral',
  mixed: 'stats.outcome.tone_mixed',
  negative: 'stats.outcome.tone_negative',
};
const tones = computed(() =>
  STATS_TONES.map((tone) => ({
    tone,
    labelKey: TONE_KEYS[tone],
    value: props.outcome.sentiment[tone],
  })),
);

// Each language as a share of the conversations a language was judged for:
// a summary that stored none is in no chip, so the chips add up to the whole.
const languages = computed(() => {
  let judged = 0;
  for (const language of props.outcome.languages) judged += language.conversations;
  return props.outcome.languages
    .filter((language) => language.conversations > 0)
    .map((language) => ({
      code: language.code,
      conversations: language.conversations,
      share: wholeShare(language.conversations, judged) ?? 0,
    }));
});
</script>

<template>
  <ProfileStatsCard class="stats-rise" :title="$t('stats.outcome.title')">
    <template v-if="segments.length">
      <ProfileStatsStackBar
        :segments="segments"
        variant="tall"
        label-key="stats.outcome.bar_label"
      >
        <template #tip="{ segment }">
          <b>{{ segment.labelKey ? $t(segment.labelKey) : segment.label }}</b>
          <br />
          {{
            $t(
              'stats.agents.conversations',
              { count: format.number(segment.value) },
              segment.value,
            )
          }}
          · {{ format.percent(segment.percent / 100) }}
        </template>
      </ProfileStatsStackBar>

      <ul class="stats-lg">
        <li
          v-for="part in legend"
          :key="part.key"
          :data-stats-part="part.key"
          :data-stats-value="part.value"
        >
          <i :style="{ background: part.color }" aria-hidden="true" />
          {{ $t(part.labelKey) }}
          <b>{{ format.number(part.value) }}</b>
        </li>
      </ul>
    </template>

    <template v-if="summarised > 0">
      <ul class="stats-sent" :aria-label="$t('stats.outcome.tone_label')">
        <li
          v-for="tone in tones"
          :key="tone.tone"
          :data-stats-tone="tone.tone"
          :data-stats-value="tone.value"
        >
          <b>{{ format.number(tone.value) }}</b>
          <small>{{ $t(tone.labelKey) }}</small>
        </li>
      </ul>

      <ul
        v-if="languages.length"
        class="stats-chips"
        :aria-label="$t('stats.outcome.languages_label')"
      >
        <li
          v-for="language in languages"
          :key="language.code"
          class="stats-chip"
          :data-stats-language="language.code"
          :data-stats-value="language.conversations"
        >
          {{
            $t('stats.outcome.language', {
              name: format.languageName(language.code),
              percent: format.percent(language.share),
            })
          }}
        </li>
      </ul>
    </template>
    <p v-else class="stats-soft" data-stats-outcome-none>{{ $t('stats.outcome.none') }}</p>
  </ProfileStatsCard>
</template>
