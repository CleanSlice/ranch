<script setup lang="ts">
import type { IStatsActivity } from '#profile/domain';
import { INTENSITY_LEVELS } from '#profile/utils/intensity';
import type { StatsPeriod } from '#profile/utils/statsView';

/**
 * Activity (CLEAN-258): the calendar of 13 weeks, the period by weekday, the
 * busiest weekday and the number of days with conversations; or the same
 * days as a table.
 *
 * A day counts the conversations the person wrote in that day, not the ones
 * started on it: a conversation can go on for weeks (spec 038, Edge Cases).
 * Days can therefore add up to more than the scoreboard's conversations, and
 * the caption says what is counted so that this is not read as an error.
 */
const props = defineProps<{
  activity: IStatsActivity;
  period: StatsPeriod;
  /** Set when activity is counted from a day inside the period. */
  since?: Date | null;
}>();

const format = useFormat();

/** Chart or table: this block's view state. */
const asTable = ref(false);

/** Long weekday names, Monday first. Short ones come from `useFormat()`. */
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** From the prototype: the busiest weekday's bar is 40 px, none is under 3. */
const BAR_MAX_PX = 40;
const BAR_MIN_PX = 3;

const weekdays = computed(() => {
  const counts = WEEKDAY_KEYS.map((_, index) => props.activity.weekdays[index] ?? 0);
  const most = Math.max(...counts);
  // The first of equals, as in the prototype; nobody when the period is empty.
  const busiest = most > 0 ? counts.indexOf(most) : -1;
  return WEEKDAY_KEYS.map((key, index) => {
    const count = counts[index] ?? 0;
    return {
      key,
      index,
      count,
      height: Math.max(BAR_MIN_PX, most > 0 ? (BAR_MAX_PX * count) / most : 0),
      busiest: index === busiest,
    };
  });
});
const busiest = computed(() => weekdays.value.find((day) => day.busiest) ?? null);

/**
 * 0 = Monday … 6 = Sunday for a `YYYY-MM-DD` day, or -1 for anything else.
 * UTC arithmetic on the string, as the calendar does: the API has already
 * put the day in the viewer's zone.
 */
function weekdayOf(date: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(utc) ? -1 : (new Date(utc).getUTCDay() + 6) % 7;
}

// The period's days, today first. All of them: the calendar leaves out the
// few days before its first Monday, the table does not.
const rows = computed(() =>
  props.activity.days
    .slice(-props.period)
    .reverse()
    .map((day) => ({ ...day, weekday: weekdayOf(day.date) })),
);
</script>

<template>
  <ProfileStatsCard
    class="stats-rise"
    :title="$t('stats.activity.title')"
    :caption="$t('stats.activity.caption')"
  >
    <template #action>
      <ProfileStatsTableToggle v-model="asTable" />
    </template>

    <div
      v-if="asTable"
      class="stats-tblwrap"
      tabindex="0"
      role="region"
      :aria-label="$t('stats.activity.table_label')"
      data-stats-table
    >
      <table class="stats-table">
        <thead>
          <tr>
            <th scope="col">{{ $t('stats.activity.table_day') }}</th>
            <th scope="col" class="stats-table__num">
              {{ $t('stats.activity.table_conversations') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.date" :data-date="row.date">
            <td>
              {{ format.dayMonth(row.date)
              }}<template v-if="row.weekday >= 0">, {{ format.weekdayShort(row.weekday) }}</template>
            </td>
            <td class="stats-table__num">{{ format.number(row.conversations) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-else>
      <ProfileStatsCalendar :days="activity.days" :period="period" />

      <div class="stats-cal-side">
        <ul class="stats-days" :aria-label="$t('stats.activity.weekdays_label')">
          <ProfileStatsTip v-for="day in weekdays" :key="day.key">
            <li
              class="stats-days__day"
              :class="day.busiest && 'stats-days__day--top'"
              tabindex="0"
              :data-weekday="day.key"
              :data-count="day.count"
            >
              <span class="sr-only">
                {{ $t(`stats.weekday.${day.key}`) }}:
                {{ $t('stats.activity.day_conversations', { count: day.count }, day.count) }}
              </span>
              <i class="stats-days__bar" :style="{ height: `${day.height}px` }" aria-hidden="true" />
              <span aria-hidden="true">{{ format.weekdayShort(day.index) }}</span>
            </li>
            <template #tip>
              <b>{{ $t(`stats.weekday.${day.key}`) }}</b>
              <br />
              {{
                $t('stats.activity.in_days', {
                  conversations: $t(
                    'stats.activity.day_conversations',
                    { count: day.count },
                    day.count,
                  ),
                  count: period,
                })
              }}
            </template>
          </ProfileStatsTip>
        </ul>

        <div class="flex flex-col gap-2">
          <!-- The busiest day is named, not only painted copper. -->
          <i18n-t scope="global"
            v-if="busiest"
            keypath="stats.activity.busiest"
            tag="div"
            class="stats-kv"
            data-stats-busiest
          >
            <template #day>
              <b>{{ $t(`stats.weekday.${busiest.key}`) }}</b>
            </template>
          </i18n-t>
          <i18n-t scope="global"
            keypath="stats.activity.active_days"
            tag="div"
            class="stats-kv"
            data-stats-active-days
          >
            <template #active>
              <b>{{ format.number(activity.activeDays) }}</b>
            </template>
            <template #count>{{ period }}</template>
          </i18n-t>
          <div class="stats-scale">
            {{ $t('stats.activity.less') }}
            <i v-for="level in INTENSITY_LEVELS" :key="level" :style="{ background: `var(--s${level - 1})` }" />
            {{ $t('stats.activity.more') }}
          </div>
        </div>
      </div>
    </template>

    <template v-if="since" #note>
      {{ $t('stats.state.counted_since', { date: format.dayMonth(since) }) }}
    </template>
  </ProfileStatsCard>
</template>
