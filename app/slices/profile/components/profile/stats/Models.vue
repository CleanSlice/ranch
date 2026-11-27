<script setup lang="ts">
import { UNKNOWN_MODEL, type IStatsModels } from '#profile/domain';
import { MODEL_LABEL_MIN_PERCENT, stackSegments } from '#profile/utils/stackSegments';

/**
 * "Who answers you" (CLEAN-258): the person's messages by the model that
 * answered them, and the model that answers most.
 *
 * A message is attributed to the model the agent ran on the day it was sent.
 * Where no record of that day exists the agent's current model stands in, and
 * only then does the card say so (`models.fallback`): the prototype printed
 * that line always, because it had nothing but the current model.
 *
 * A model's name is shown as received. The one the console words itself is
 * `unknown`, which the API uses for messages it could name no model for.
 *
 * With nothing to show there is no card: an empty bar would be a chart of
 * nothing.
 */
const props = defineProps<{ models: IStatsModels }>();

const format = useFormat();

/**
 * The four most used models take the categorical colours in order; any
 * further one, and the unknown model wherever it ranks, takes the neutral
 * colour, which also needs light text. The legend under the bar names them
 * all, so two neutral neighbours are still told apart.
 */
const CATEGORICAL = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'] as const;
const NEUTRAL = 'var(--c0)';

const segments = computed(() => {
  const parts = stackSegments(
    props.models.items.map((item) => ({ key: item.model, value: item.messages })),
    MODEL_LABEL_MIN_PERCENT,
  );
  let named = 0;
  return parts.map((part) => {
    const unknown = part.key === UNKNOWN_MODEL;
    const color = unknown ? undefined : CATEGORICAL[named++];
    return {
      key: part.key,
      label: part.key,
      labelKey: unknown ? 'stats.models.unknown' : undefined,
      value: part.value,
      percent: part.percent,
      showLabel: part.label,
      color: color ?? NEUTRAL,
      light: color === undefined,
    };
  });
});

// The largest share; the first of equals, which is the API's own order.
const top = computed(() => {
  let best = segments.value[0] ?? null;
  for (const segment of segments.value) {
    if (best && segment.value > best.value) best = segment;
  }
  return best;
});
</script>

<template>
  <ProfileStatsCard
    v-if="top"
    class="stats-rise"
    :title="$t('stats.models.title')"
    :caption="$t('stats.models.caption')"
  >
    <div class="stats-kv">{{ $t('stats.models.top') }}</div>
    <div class="mb-3 mt-1 font-mono text-base [overflow-wrap:anywhere]" data-stats-top-model>
      {{ top.labelKey ? $t(top.labelKey) : top.label }}
    </div>

    <ProfileStatsStackBar :segments="segments" variant="tall" label-key="stats.models.bar_label">
      <template #tip="{ segment }">
        <b>{{ segment.labelKey ? $t(segment.labelKey) : segment.label }}</b>
        <br />
        {{
          $t('stats.models.your_messages', { count: format.number(segment.value) }, segment.value)
        }}
        · {{ format.percent(segment.percent / 100) }}
      </template>
    </ProfileStatsStackBar>

    <ul class="stats-lg">
      <li v-for="segment in segments" :key="segment.key">
        <i :style="{ background: segment.color }" aria-hidden="true" />
        {{ segment.labelKey ? $t(segment.labelKey) : segment.label }}
        <b>{{ format.number(segment.value) }}</b>
      </li>
    </ul>

    <template v-if="models.fallback" #note>{{ $t('stats.models.fallback') }}</template>
  </ProfileStatsCard>
</template>
