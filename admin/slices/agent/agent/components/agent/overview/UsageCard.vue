<script setup lang="ts">
/**
 * Usage (CLEAN-228, User Story 6): the 30-day figures and the last seven
 * days as one small chart of input tokens, each day's value written above its
 * bar. The full 30 days — per model, paginated — are the existing usage
 * panel, unchanged, one press away in a sheet.
 *
 * Rendered from the usage store's record for this agent; the request is the
 * one the summary strip and the header's usage line already share.
 */
import { useAgentUsage } from '#agent/composables/useAgentUsage'
import { formatCompact } from '#agent/utils/agentFormat'
import { usageDays } from '#usage/utils/usageDays'
import { dayKey, formatDay, formatMoney, formatNumber } from '#common/utils/format'

const props = defineProps<{ agentId: string }>()

const { usage, state } = useAgentUsage(props.agentId)

// The viewer's own day, read once when the block opens.
const today = new Date()
const todayKey = dayKey(today)

const days = computed(() =>
  usage.value ? usageDays(usage.value.last30days, today, 7) : [],
)

const isEmpty = computed(
  () =>
    !!usage.value &&
    usage.value.totals.callCount === 0 &&
    usage.value.last30days.length === 0,
)

const tallest = computed(() => {
  let max = 0
  for (let i = 0; i < days.value.length; i += 1) {
    if (days.value[i]!.inputTokens > max) max = days.value[i]!.inputTokens
  }
  return max
})

// 76 px is the tallest bar; a day with something in it is never drawn
// thinner than 2 px, and a day with nothing keeps a hairline so the row of
// seven reads as seven.
const BAR_PX = 76
function barHeight(value: number): string {
  if (value <= 0 || tallest.value <= 0) return '1px'
  return `${Math.max(2, Math.round((value / tallest.value) * BAR_PX))}px`
}

// `YYYY-MM-DD` as a day of the viewer's calendar — `new Date('2026-11-10')`
// would be midnight UTC, the evening before for half the world.
function dayLabel(date: string): string {
  if (date === todayKey) return 'Today'
  const [year, month, day] = date.split('-').map(Number)
  return formatDay(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1), today)
}

const sheetOpen = ref(false)
</script>

<template>
  <section class="rounded-xl border bg-card" data-block="usage" :data-state="state">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 pt-4">
      <h2 class="text-[15px] font-semibold">Usage</h2>
      <button
        type="button"
        class="ml-auto rounded-sm text-[12.5px] underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        data-usage-all
        @click="sheetOpen = true"
      >
        All 30 days
      </button>
      <p class="basis-full text-[13px] text-muted-foreground">This agent only.</p>
    </header>

    <div class="flex flex-col gap-3.5 px-5 pb-[18px] pt-3">
      <div v-if="state === 'loading'" class="grid grid-cols-2 gap-3 min-[760px]:grid-cols-4">
        <div v-for="i in 4" :key="i" class="space-y-2">
          <Skeleton class="h-3 w-20 motion-reduce:animate-none" />
          <Skeleton class="h-5 w-16 motion-reduce:animate-none" />
        </div>
      </div>

      <p v-else-if="!usage" class="text-[13px] text-muted-foreground" data-usage-unavailable>
        Usage is not available right now. Reload the page to try again.
      </p>

      <template v-else>
        <dl class="grid grid-cols-2 gap-3 min-[760px]:grid-cols-4">
          <div class="min-w-0" data-usage-kpi="cost">
            <dt class="text-xs text-muted-foreground">Cost, 30 days</dt>
            <dd class="text-base font-semibold tabular-nums">{{ formatMoney(usage.totals.costUsd) }}{{ ' ' }}</dd>
          </div>
          <div class="min-w-0" data-usage-kpi="calls">
            <dt class="text-xs text-muted-foreground">Calls, 30 days</dt>
            <dd class="text-base font-semibold tabular-nums">{{ formatNumber(usage.totals.callCount) }}{{ ' ' }}</dd>
          </div>
          <div class="min-w-0" data-usage-kpi="input" :title="formatNumber(usage.totals.inputTokens)">
            <dt class="text-xs text-muted-foreground">Input tokens</dt>
            <dd class="text-base font-semibold tabular-nums">{{ formatCompact(usage.totals.inputTokens) }}{{ ' ' }}</dd>
          </div>
          <div class="min-w-0" data-usage-kpi="output" :title="formatNumber(usage.totals.outputTokens)">
            <dt class="text-xs text-muted-foreground">Output tokens</dt>
            <dd class="text-base font-semibold tabular-nums">{{ formatCompact(usage.totals.outputTokens) }}{{ ' ' }}</dd>
          </div>
        </dl>

        <p v-if="isEmpty" class="text-[13px] text-muted-foreground" data-usage-empty>
          No usage yet. The figures appear after this agent's first model call.
        </p>

        <div v-else>
          <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 class="text-[13.5px] font-semibold">Input tokens by day</h3>
            <span class="text-[12.5px] text-muted-foreground" data-usage-today>
              Today so far:
              {{ formatNumber(usage.today.callCount) }}
              {{ usage.today.callCount === 1 ? 'call' : 'calls' }},
              {{ formatCompact(usage.today.inputTokens) }} in,
              {{ formatCompact(usage.today.outputTokens) }} out
            </span>
          </div>
          <!-- Every bar carries its number above it and its day below it, so
               the chart reads the same without the picture. The `{{ ' ' }}`
               keeps them apart as text: the compiler drops the line break
               between two elements, and "2.4M" would run into "Nov 10". -->
          <ol class="grid h-[120px] grid-cols-7 items-end gap-2" aria-label="Input tokens, last seven days">
            <li
              v-for="d in days"
              :key="d.date"
              class="flex h-full min-w-0 flex-col items-center justify-end gap-1 text-[11px] text-muted-foreground"
              :title="`${dayLabel(d.date)}: ${formatNumber(d.inputTokens)} input tokens, ${formatNumber(d.calls)} calls`"
              :data-usage-day="d.date"
              :data-value="d.inputTokens"
              :data-today="d.date === todayKey ? '' : undefined"
            >
              <b class="max-w-full truncate font-medium text-foreground tabular-nums">
                {{ formatCompact(d.inputTokens) }}
              </b>{{ ' ' }}
              <span
                class="w-full max-w-14 shrink-0 rounded-t-[5px]"
                :class="d.date === todayKey ? 'bg-primary' : 'bg-muted-foreground/30'"
                :style="{ height: barHeight(d.inputTokens) }"
                aria-hidden="true"
              />
              <span
                class="max-w-full truncate"
                :class="d.date === todayKey && 'font-semibold text-foreground'"
              >
                {{ dayLabel(d.date) }}
              </span>{{ ' ' }}
            </li>
          </ol>
        </div>
      </template>
    </div>

    <Sheet v-model:open="sheetOpen">
      <SheetContent side="right" class="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Usage, all 30 days</SheetTitle>
          <SheetDescription>This agent only, by day and model.</SheetDescription>
        </SheetHeader>
        <div class="px-4 pb-4">
          <UsagePanel :agent-id="agentId" agent-only />
        </div>
      </SheetContent>
    </Sheet>
  </section>
</template>
