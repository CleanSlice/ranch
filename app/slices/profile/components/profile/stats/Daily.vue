<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import type { IInstallationDay, IInstallationModel } from '#profile/domain';
import { axisScale } from '#profile/utils/axisScale';
import { dailyColumns, dayBars, dayPricing, type DayPricing } from '#profile/utils/dailyColumns';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * "Spend by day" (CLEAN-265): the tokens of every UTC day of the period as a
 * column stacked by model, or the same days as a table.
 *
 * The drawing is computed elsewhere and only drawn here: the value axis is
 * `axisScale()`, the columns and the dates under them are `dailyColumns()`,
 * the bars of a column `dayBars()`, which also keeps a day of a few tokens
 * from being drawn as nothing.
 * It is drawn at the width the card has, one unit to a pixel, and not scaled
 * to fit: a scaled chart on a phone has dates five pixels high. So 90 days at
 * 390 px are 90 columns two pixels wide with four dates under them.
 *
 * The picture itself is hidden from a screen reader. Over it lies one cell
 * per day, which is what a pointer and the keyboard land on: its label reads
 * the day and its detail lists the models. The cells are one tab stop, walked
 * with the arrows, so that 90 days do not stand between a keyboard and the
 * next card.
 *
 * A model the price list does not have is told by the dashed "no price" mark
 * in the legend, and a day of such models alone shows that mark where its
 * cost would be: its money is not zero, it is unknown. A day that mixes
 * priced and unpriced models keeps its cost, which is of the priced ones
 * only, and wherever that cost is printed (the cell's label, its detail, the
 * table row) it carries the dashed "+" an agent's partial cost has in
 * "Agents by cost", or the same in words. Which of the three a day is, is
 * `dayPricing()`. A model's name is shown as received.
 */
const props = defineProps<{
  /** One entry per UTC day of the period, oldest first, today last. */
  daily: IInstallationDay[];
  /** Every model of the period, most tokens first: the legend. */
  models: IInstallationModel[];
  period: StatsPeriod;
}>();

const format = useFormat();

/** Chart or table: this block's view state. */
const asTable = ref(false);

/**
 * The four most used models take the categorical colours in order; any
 * further one takes the neutral colour. The legend names them all, and so
 * does a day's detail, so two neutral neighbours are still told apart.
 */
const CATEGORICAL = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'] as const;
const NEUTRAL = 'var(--c0)';

const legend = computed(() =>
  props.models.map((model, index) => ({
    model: model.model,
    priced: model.priced,
    color: CATEGORICAL[index] ?? NEUTRAL,
    rank: index,
  })),
);

/**
 * What a day's cell is called, read out whole: one sentence per kind of day,
 * chosen here and worded in the locale file, each with the day, its tokens
 * and its cost as it needs them. Nothing is put together in the template.
 */
const CELL_LABEL: Record<DayPricing, string> = {
  priced: 'stats.daily.cell_label',
  partial: 'stats.daily.cell_label_partial',
  unpriced: 'stats.daily.cell_label_no_price',
};
const CELL_LABEL_NONE = 'stats.daily.cell_label_none';

const days = computed(() => {
  const known = new Map(legend.value.map((entry) => [entry.model, entry]));
  return props.daily.map((day, index) => {
    const parts = day.byModel
      .filter((part) => part.tokens > 0)
      .map((part) => {
        const entry = known.get(part.model);
        return {
          model: part.model,
          tokens: part.tokens,
          color: entry?.color ?? NEUTRAL,
          // A model the legend does not list has no word on its price:
          // it is not called unpriced on a guess.
          priced: entry?.priced !== false,
          rank: entry?.rank ?? Number.MAX_SAFE_INTEGER,
        };
      })
      // Stacked in the legend's order, so a model keeps its place from
      // column to column.
      .sort((a, b) => a.rank - b.rank);
    let total = 0;
    const tokens = new Map<string, number>();
    for (const part of parts) {
      total += part.tokens;
      tokens.set(part.model, part.tokens);
    }
    const pricing = dayPricing(parts);
    return {
      date: day.date,
      index,
      cost: day.cost,
      parts,
      tokens,
      total,
      // `unpriced`: usage, and none of it priced, so the day's cost is
      // unknown, not zero. `partial`: the cost leaves some models out.
      pricing,
      labelKey: total > 0 ? CELL_LABEL[pricing] : CELL_LABEL_NONE,
    };
  });
});

const hasUsage = computed(() => days.value.some((day) => day.total > 0));
/** Some day's cost leaves models out: the table explains its "+" once. */
const hasPartial = computed(() => days.value.some((day) => day.pricing === 'partial'));

// ── the drawing ──
// From the prototype's `daily()`: 170 px of plot under 8 px of air, 22 px for
// the dates, and at least 34 px on the left for the axis values.
const HEIGHT = 170;
const TOP = 8;
const FOOT = 22;
const PAD_MIN = 34;
/** The axis type is 10 px monospace: six pixels a character. */
const CHAR = 6;
const AXIS_GAP = 6;

const box = ref<HTMLElement | null>(null);
const { width: measured } = useElementSize(box);
/** The width the chart has on screen; 0 until it has been measured. */
const width = computed(() => Math.floor(measured.value));

const scale = computed(() => axisScale(days.value.map((day) => day.total)));
const ticks = computed(() =>
  scale.value.ticks.map((value) => ({
    value,
    text: format.compact(value),
    y: HEIGHT - ((HEIGHT - TOP) * value) / scale.value.top,
  })),
);
// "200 тыс." is longer than "200K": the margin follows the longest value, so
// that none is cut at the card's edge.
const pad = computed(() => {
  let longest = 0;
  for (const tick of ticks.value) longest = Math.max(longest, tick.text.length);
  return Math.max(PAD_MIN, longest * CHAR + AXIS_GAP + 2);
});
const cols = computed(() => dailyColumns(days.value.length, width.value, pad.value));

/** Two decimals are finer than a screen draws and keep the markup readable. */
const px = (value: number) => Math.round(value * 100) / 100;

const columns = computed(() => {
  const { slot, column } = cols.value;
  const plot = HEIGHT - TOP;
  return days.value.map((day) => {
    const x = pad.value + day.index * slot + (slot - column) / 2;
    return { date: day.date, x: px(x), bars: dayBars(day.parts, scale.value.top, plot, HEIGHT) };
  });
});

/** The topmost bar of a column: its two upper corners are rounded. */
function capped(x: number, y: number, w: number, h: number): string {
  const r = px(Math.min(4, h, w / 2));
  return (
    `M${x} ${px(y + h)}V${px(y + r)}q0 ${-r} ${r} ${-r}` +
    `H${px(x + w - r)}q${r} 0 ${r} ${r}V${px(y + h)}Z`
  );
}

const dates = computed(() => {
  const { slot, labels } = cols.value;
  const out: { date: string; x: number; anchor: 'start' | 'middle' | 'end' }[] = [];
  for (const label of labels) {
    const day = days.value[label.index];
    if (!day) continue;
    const left = pad.value + label.index * slot;
    const x =
      label.anchor === 'start' ? left : label.anchor === 'end' ? left + slot : left + slot / 2;
    out.push({ date: day.date, x: px(x), anchor: label.anchor });
  }
  return out;
});

// ── the cells: one tab stop, walked with the arrows ──
const chosen = ref<number | null>(null);
watch(
  () => props.period,
  () => {
    chosen.value = null;
  },
);
// The day the Tab key lands on: the one last visited, today otherwise.
const active = computed(() => {
  const last = days.value.length - 1;
  return chosen.value !== null && chosen.value <= last ? chosen.value : last;
});

function onKeydown(event: KeyboardEvent, index: number) {
  const last = days.value.length - 1;
  let next: number | null = null;
  if (event.key === 'ArrowRight') next = Math.min(last, index + 1);
  else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = last;
  if (next === null) return;
  event.preventDefault();
  const cells = (event.currentTarget as HTMLElement).parentElement?.children;
  (cells?.[next] as HTMLElement | undefined)?.focus();
}

// The table: today first, every day of the period.
const rows = computed(() => days.value.slice().reverse());
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.daily.title')"
    :caption="$t('stats.daily.caption')"
  >
    <template v-if="hasUsage" #action>
      <ProfileStatsTableToggle v-model="asTable" />
    </template>

    <p v-if="!hasUsage" class="stats-kv" data-stats-daily-none>
      {{ $t('stats.daily.none', { count: period }) }}
    </p>

    <div
      v-else-if="asTable"
      class="stats-tblwrap"
      tabindex="0"
      role="region"
      :aria-label="$t('stats.daily.table_label')"
      data-stats-table
    >
      <table class="stats-table">
        <caption class="sr-only">{{ $t('stats.daily.table_label') }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ $t('stats.daily.table_day') }}</th>
            <th
              v-for="entry in legend"
              :key="entry.model"
              scope="col"
              class="stats-table__num stats-table__model"
            >
              {{ entry.model }}
              <span v-if="!entry.priced" class="stats-noprice">
                {{ $t('stats.daily.no_price') }}
              </span>
            </th>
            <th scope="col" class="stats-table__num stats-table__nowrap">
              {{ $t('stats.daily.table_cost') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in rows" :key="day.date" :data-date="day.date">
            <th scope="row" class="stats-table__nowrap">{{ format.dayMonth(day.date) }}</th>
            <td v-for="entry in legend" :key="entry.model" class="stats-table__num">
              {{ format.compact(day.tokens.get(entry.model) ?? 0) }}
            </td>
            <td
              class="stats-table__num stats-table__nowrap"
              :data-stats-pricing="day.pricing"
            >
              <span v-if="day.pricing === 'unpriced'" class="stats-noprice">
                {{ $t('stats.daily.no_price') }}
              </span>
              <!-- No pop-up on the mark here: with a model that has no price
                   in daily use every row would be a tab stop. The mark is read
                   out in words, and explained once under the table. -->
              <template v-else>
                {{ format.estimate(day.cost)
                }}<span
                  v-if="day.pricing === 'partial'"
                  class="stats-noprice stats-noprice--plus"
                  role="img"
                  :aria-label="$t('stats.daily.partial_tip')"
                  data-stats-partial
                  >+</span
                >
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-else>
      <div ref="box" class="stats-chart" data-stats-chart>
        <template v-if="width > 0">
          <svg
            :width="width"
            :height="HEIGHT + FOOT"
            :viewBox="`0 0 ${width} ${HEIGHT + FOOT}`"
            aria-hidden="true"
          >
            <g v-for="tick in ticks" :key="tick.value">
              <line class="stats-chart__line" :x1="pad" :x2="width" :y1="px(tick.y)" :y2="px(tick.y)" />
              <text class="stats-chart__axis" :x="pad - AXIS_GAP" :y="px(tick.y + 3)" text-anchor="end">
                {{ tick.text }}
              </text>
            </g>
            <g v-for="column in columns" :key="column.date" :data-date="column.date">
              <template v-for="(bar, level) in column.bars" :key="bar.key">
                <path
                  v-if="level === column.bars.length - 1"
                  :d="capped(column.x, bar.y, px(cols.column), bar.height)"
                  :style="{ fill: bar.color }"
                />
                <!-- A pixel of air above every bar that has another on top. -->
                <rect
                  v-else
                  :x="column.x"
                  :y="px(bar.y + 1)"
                  :width="px(cols.column)"
                  :height="px(Math.max(0.5, bar.height - 1))"
                  :style="{ fill: bar.color }"
                />
              </template>
            </g>
            <text
              v-for="label in dates"
              :key="label.date"
              class="stats-chart__axis"
              :x="label.x"
              :y="HEIGHT + 15"
              :text-anchor="label.anchor"
            >
              {{ format.dayMonth(label.date) }}
            </text>
          </svg>

          <div
            class="stats-chart__hits"
            :style="{ left: `${pad}px`, height: `${HEIGHT}px` }"
            role="group"
            :aria-label="$t('stats.daily.chart_label', { count: period })"
          >
            <ProfileStatsTip v-for="day in days" :key="day.date">
              <span
                class="stats-chart__hit"
                :tabindex="day.index === active ? 0 : -1"
                role="img"
                :aria-label="
                  $t(day.labelKey, {
                    day: format.dayMonth(day.date),
                    tokens: $t('stats.cost.tokens', { count: format.compact(day.total) }, day.total),
                    cost: format.estimate(day.cost),
                  })
                "
                :data-date="day.date"
                :data-tokens="day.total"
                :data-stats-pricing="day.pricing"
                @focus="chosen = day.index"
                @keydown="onKeydown($event, day.index)"
              />
              <template #tip>
                <b>{{ format.dayMonth(day.date) }}</b>
                <template v-if="day.total > 0">
                  <div v-for="part in day.parts" :key="part.model" class="stats-tip__row">
                    <i :style="{ background: part.color }" aria-hidden="true" />
                    <span class="stats-tip__name">{{ part.model }}</span>
                    <em>{{ format.compact(part.tokens) }}</em>
                  </div>
                  <div class="stats-tip__row">
                    <span class="stats-tip__name">{{ $t('stats.daily.day_cost') }}</span>
                    <span v-if="day.pricing === 'unpriced'" class="stats-noprice">
                      {{ $t('stats.daily.no_price') }}
                    </span>
                    <template v-else>
                      <em>{{ format.estimate(day.cost) }}</em>
                      <!-- Drawn only: the line under it has the words. -->
                      <span
                        v-if="day.pricing === 'partial'"
                        class="stats-noprice stats-noprice--plus"
                        aria-hidden="true"
                        data-stats-partial
                        >+</span
                      >
                    </template>
                  </div>
                  <div
                    v-if="day.pricing === 'partial'"
                    class="stats-tip__dim"
                    data-stats-partial-note
                  >
                    {{ $t('stats.daily.partial_tip') }}
                  </div>
                </template>
                <template v-else>
                  <br />
                  <span class="stats-tip__dim">{{ $t('stats.daily.day_none') }}</span>
                </template>
              </template>
            </ProfileStatsTip>
          </div>
        </template>
      </div>

      <ul class="stats-lg" data-stats-legend>
        <li v-for="entry in legend" :key="entry.model" :data-model="entry.model">
          <i :style="{ background: entry.color }" aria-hidden="true" />
          {{ entry.model }}
          <ProfileStatsTip v-if="!entry.priced">
            <span class="stats-noprice" tabindex="0" data-stats-no-price>
              {{ $t('stats.daily.no_price') }}
            </span>
            <template #tip>{{ $t('stats.daily.no_price_tip') }}</template>
          </ProfileStatsTip>
        </li>
      </ul>
    </template>

    <!-- What the "+" beside a cost in the table says, once and in sight: a
         touch opens no pop-up. In the chart each such day says it in its own
         detail. After the chain above, not inside it. -->
    <p v-if="hasUsage && asTable && hasPartial" class="stats-hint" data-stats-partial-note>
      <span class="stats-noprice stats-noprice--plus stats-noprice--key" aria-hidden="true"
        >+</span
      >
      {{ $t('stats.daily.partial_tip') }}
    </p>

    <template v-if="hasUsage" #note>{{ $t('stats.daily.today') }}</template>
  </ProfileStatsCard>
</template>
