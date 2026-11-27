<script setup lang="ts">
/**
 * Parts of a whole as one segmented bar (CLEAN-258): tall, with the percent
 * printed inside the segments wide enough for it, or thin, with none.
 *
 * It draws what `utils/stackSegments.ts` computed and decides nothing about
 * widths or labels. The colour never stands alone: the group's label reads
 * every part with its share, each segment takes focus and shows its detail,
 * and the card puts a legend with the names under the bar.
 *
 * A name the console words itself travels as `labelKey`; a name received
 * from the server is `label` and is shown as it came (docs/i18n.md).
 */
defineProps<{
  segments: readonly {
    key: string;
    label: string;
    labelKey?: string;
    /** What the segment's width is in proportion to. */
    value: number;
    /** Whole percent of the bar, as printed. */
    percent: number;
    /** Whether the percent fits inside (tall bar only). */
    showLabel: boolean;
    /** A CSS colour, normally one of the `--c*` properties. */
    color: string;
    /** Light text, for a colour the dark label does not read on. */
    light?: boolean;
  }[];
  variant: 'tall' | 'thin';
  /** A key whose text has `{values}`: the sentence that reads the bar aloud. */
  labelKey: string;
}>();

const format = useFormat();
</script>

<template>
  <div
    :class="variant === 'tall' ? 'stats-tall' : 'stats-thin'"
    role="group"
    :aria-label="
      $t(labelKey, {
        values: segments
          .map(
            (s) => `${s.labelKey ? $t(s.labelKey) : s.label} ${format.percent(s.percent / 100)}`,
          )
          .join(', '),
      })
    "
    data-stats-bar
  >
    <ProfileStatsTip v-for="segment in segments" :key="segment.key">
      <span
        class="stats-bar__seg"
        :class="segment.light && 'stats-bar__seg--light'"
        :style="{ flex: `${segment.value} 1 0%`, background: segment.color }"
        tabindex="0"
        role="img"
        :aria-label="`${segment.labelKey ? $t(segment.labelKey) : segment.label}: ${format.percent(segment.percent / 100)}`"
        :data-segment="segment.key"
      >
        <template v-if="variant === 'tall' && segment.showLabel">
          {{ format.percent(segment.percent / 100) }}
        </template>
      </span>
      <template #tip>
        <slot name="tip" :segment="segment">
          <b>{{ segment.labelKey ? $t(segment.labelKey) : segment.label }}</b>
          <br />
          {{ format.percent(segment.percent / 100) }}
        </slot>
      </template>
    </ProfileStatsTip>
  </div>
</template>
