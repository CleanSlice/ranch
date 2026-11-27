<script setup lang="ts">
import type { IStatsDay } from '#profile/domain';
import { calendarGrid } from '#profile/utils/calendarGrid';
import { intensityLevel } from '#profile/utils/intensity';

/**
 * The activity calendar (CLEAN-258): the last 13 weeks, a column per week,
 * Monday on top. Where a day sits is `calendarGrid()`, how strongly it is
 * painted is `intensityLevel()`; this draws them.
 *
 * A day with conversations takes focus and shows its date and count, on
 * hover as well. An empty day shows nothing on hover, so it is not a tab
 * stop either: 91 stops to read "no conversations" would bury the days that
 * have something to say. Every day, empty or not, is in the table view,
 * which the calendar's label points to.
 *
 * Today is told by an outline and a day outside the period by being dimmed
 * and by words in its detail: neither rests on the fill colour.
 */
const props = defineProps<{
  days: IStatsDay[];
  /** The selected period in days: older days are dimmed. */
  period: number;
}>();

const format = useFormat();

const grid = computed(() => calendarGrid(props.days, props.period));
</script>

<template>
  <div class="stats-cal-wrap">
    <div
      class="stats-cal"
      role="group"
      :aria-label="$t('stats.activity.calendar_label')"
      data-stats-calendar
    >
      <span
        v-for="month in grid.months"
        :key="`month-${month.column}`"
        class="stats-cal__month"
        :style="{ gridColumn: month.column }"
        aria-hidden="true"
      >
        {{ format.monthShort(month.month) }}
      </span>

      <!-- The month names take grid row 1, so a day's row is one further down. -->
      <template v-for="(cell, index) in grid.cells" :key="cell.date">
        <ProfileStatsTip v-if="cell.conversations > 0">
          <span
            class="stats-cal__cell stats-cal__cell--lit"
            :class="{
              'stats-cal__cell--out': cell.outside,
              'stats-cal__cell--today': cell.today,
            }"
            :style="{
              gridColumn: cell.column,
              gridRow: cell.row + 1,
              background: `var(--s${intensityLevel(cell.conversations)})`,
              '--k': index,
            }"
            tabindex="0"
            role="img"
            :aria-label="
              `${format.dayMonth(cell.date)}: ` +
              $t('stats.activity.day_conversations', { count: cell.conversations }, cell.conversations) +
              (cell.outside ? `, ${$t('stats.activity.outside')}` : '')
            "
            :data-date="cell.date"
            :data-count="cell.conversations"
          />
          <template #tip>
            <b>{{ format.dayMonth(cell.date) }}, {{ format.weekdayShort(cell.row - 1) }}</b>
            <br />
            {{
              $t(
                'stats.activity.day_conversations',
                { count: cell.conversations },
                cell.conversations,
              )
            }}
            <template v-if="cell.outside">
              <br />
              <span class="stats-tip__dim">{{ $t('stats.activity.outside') }}</span>
            </template>
          </template>
        </ProfileStatsTip>
        <span
          v-else
          class="stats-cal__cell"
          :class="{
            'stats-cal__cell--out': cell.outside,
            'stats-cal__cell--today': cell.today,
          }"
          :style="{ gridColumn: cell.column, gridRow: cell.row + 1 }"
          aria-hidden="true"
          :data-date="cell.date"
          data-count="0"
        />
      </template>
    </div>
  </div>
</template>
