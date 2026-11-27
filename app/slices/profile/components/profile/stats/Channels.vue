<script setup lang="ts">
import { INSTALLATION_CHANNELS, type IInstallationChannel } from '#profile/domain';
import { stackSegments } from '#profile/utils/stackSegments';

/**
 * "Where people write" (CLEAN-265): the period's conversations by channel, as
 * a thin bar and a legend with the counts.
 *
 * It lives in the installation view only: a console account is not linked to
 * a messenger identity, so a personal breakdown would always read "console
 * 100%" (spec 038, Assumptions).
 *
 * The five channels the API names are worded by the console; one it does not
 * know yet is shown as received, in the neutral colour. A channel nobody
 * wrote on is not in the answer, and with no conversations at all there is no
 * card: an empty bar would be a chart of nothing.
 */
const props = defineProps<{
  /** Most conversations first. */
  channels: IInstallationChannel[];
}>();

const format = useFormat();

// The prototype's colours for the four it knew; "other" is the neutral part.
const COLORS: Record<string, string> = {
  console: 'var(--c1)',
  telegram: 'var(--c4)',
  slack: 'var(--c2)',
  share: 'var(--c3)',
};
const NEUTRAL = 'var(--c0)';
const KNOWN = new Set<string>(INSTALLATION_CHANNELS);

/** A thin bar prints nothing inside: no share is wide enough for a label. */
const NO_LABEL = 101;

const segments = computed(() =>
  stackSegments(
    props.channels.map((row) => ({ key: row.channel, value: row.conversations })),
    NO_LABEL,
  ).map((part) => ({
    key: part.key,
    label: part.key,
    labelKey: KNOWN.has(part.key) ? `stats.channels.${part.key}` : undefined,
    value: part.value,
    percent: part.percent,
    showLabel: part.label,
    color: COLORS[part.key] ?? NEUTRAL,
  })),
);
</script>

<template>
  <ProfileStatsCard
    v-if="segments.length"
    class="stats-rise"
    :title="$t('stats.channels.title')"
    :caption="$t('stats.channels.caption')"
  >
    <ProfileStatsStackBar :segments="segments" variant="thin" label-key="stats.channels.bar_label">
      <template #tip="{ segment }">
        <b>{{ segment.labelKey ? $t(segment.labelKey) : segment.label }}</b>
        <br />
        {{
          $t(
            'stats.channels.conversations',
            { count: format.number(segment.value) },
            segment.value,
          )
        }}
        · {{ format.percent(segment.percent / 100) }}
      </template>
    </ProfileStatsStackBar>

    <ul class="stats-lg">
      <li
        v-for="segment in segments"
        :key="segment.key"
        :data-channel="segment.key"
        :data-count="segment.value"
      >
        <i :style="{ background: segment.color }" aria-hidden="true" />
        {{ segment.labelKey ? $t(segment.labelKey) : segment.label }}
        <b>{{ format.number(segment.value) }}</b>
      </li>
    </ul>
  </ProfileStatsCard>
</template>
