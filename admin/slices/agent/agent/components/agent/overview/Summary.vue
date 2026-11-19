<script setup lang="ts">
/**
 * The strip at the top of Overview (CLEAN-228, User Story 2): is it running,
 * what did it cost, how loaded is its pod, how many requests against its
 * limit. Four cells, each worked out on its own by `utils/agentSummary.ts`,
 * so a source that failed says so in its own cell and the other three stand.
 *
 * Nothing is kept here: the agent and its pod come from the agent and status
 * stores, usage from the usage store, load from the limit store (whose poll
 * this strip joins — it is counted, so the Request limit block below shares
 * it), pod metrics from the page's one metrics poll.
 */
import type { ISummaryMeter } from '#agent/utils/agentSummary'
import { agentSummary } from '#agent/utils/agentSummary'
import { useInjectedAgentMetrics } from '#agent/composables/useAgentMetrics'
import { useAgentUsage } from '#agent/composables/useAgentUsage'
import { TONE } from '#agent/composables/useAgentRailEntries'
import { LOAD_POLL_MS } from '#agent/stores/agentLimit'
import {
  formatBytes,
  formatCompact,
  formatCpuMilli,
  usagePctClass,
} from '#agent/utils/agentFormat'
import { formatDate, formatMoney, formatNumber } from '#common/utils/format'

const props = defineProps<{ agentId: string }>()

const agentStore = useAgentStore()
const agentStatusStore = useAgentStatusStore()
const limitStore = useAgentLimitStore()

const agent = computed(() => agentStore.byId(props.agentId))
const pod = computed(() => agentStatusStore.statuses[props.agentId] ?? null)
const load = computed(() => limitStore.byAgent[props.agentId]?.load ?? null)
const { usage, state: usageState } = useAgentUsage(props.agentId)
const { metrics, answered: metricsAnswered } = useInjectedAgentMetrics()

// The load poll swallows a failed request and tries again, so "it failed" is
// not something it reports. Two missed ticks with nothing to show is the
// answer: the cell stops waiting and says the load is not available.
const loadWaited = ref(false)
let stopWatching: (() => void) | null = null
let waitTimer: ReturnType<typeof setTimeout> | null = null
onMounted(() => {
  stopWatching = limitStore.watchLoad(props.agentId)
  waitTimer = setTimeout(() => {
    loadWaited.value = true
  }, LOAD_POLL_MS * 2 + 1000)
})
onBeforeUnmount(() => {
  stopWatching?.()
  stopWatching = null
  if (waitTimer) clearTimeout(waitTimer)
})

const summary = computed(() =>
  agent.value
    ? agentSummary({
        agent: agent.value,
        pod: pod.value,
        metrics: metrics.value,
        usage: usage.value,
        load: load.value,
      })
    : null,
)

// A cell whose source has not answered yet is neither a figure nor "not
// available": it waits.
const spendLoading = computed(() => usageState.value === 'loading')
const podLoading = computed(
  () => !metricsAnswered.value && agent.value?.status !== 'stopped',
)
const requestsLoading = computed(() => !load.value && !loadWaited.value)

// Explicit `=== false`: undefined means the stream has not reported yet.
const runtimeOffline = computed(
  () =>
    agent.value?.status === 'running' &&
    agentStatusStore.bridleConnected[props.agentId] === false,
)

const statusDetail = computed(() => {
  const status = summary.value?.status
  if (!status) return ''
  const parts = [status.podText]
  if (status.restarts > 0) parts.push(`restarts ${formatNumber(status.restarts)}`)
  parts.push(`updated ${formatDate(status.updatedAt)}`)
  return parts.join(' · ')
})

const statusIsBad = computed(
  () => summary.value?.status.tone === 'bad',
)

function cpuText(meter: ISummaryMeter): string {
  return `${formatCpuMilli(meter.used)} / ${formatCpuMilli(meter.limit)}`
}

function memoryText(meter: ISummaryMeter): string {
  return `${formatBytes(meter.used)} / ${formatBytes(meter.limit)}`
}

const CELL = 'flex min-w-0 flex-col gap-1.5 px-4 py-3.5'
const LABEL = 'text-xs text-muted-foreground'
const FIGURE = 'flex min-w-0 flex-wrap items-center gap-x-2 text-xl font-semibold leading-tight tabular-nums'
const DETAIL = 'text-xs text-muted-foreground'
</script>

<template>
  <div v-if="summary" class="@container" data-summary>
    <!-- `{{ ' ' }}` after a label or a figure: the compiler drops the line
         break between two elements, and without a space a cell read as text —
         by a copy, by a test — runs "$12.34" and "2,191 calls" together into
         one number. -->
    <section
      class="grid grid-cols-2 overflow-hidden rounded-xl border bg-card @[640px]:grid-cols-4"
      aria-label="Agent summary"
    >
      <!-- Status -->
      <div
        :class="CELL"
        data-summary-cell="status"
        :data-state="summary.status.state"
        :data-status="summary.status.status"
      >
        <span :class="LABEL">Status</span>{{ ' ' }}
        <strong :class="FIGURE">
          <!-- Never colour alone: the word is next to the marker, and a
               stopped agent's marker is hollow as well as grey. -->
          <span
            class="size-2 shrink-0 rounded-full"
            :class="summary.status.tone === 'off'
              ? 'border-[1.5px] border-muted-foreground'
              : TONE[summary.status.status].dot"
            aria-hidden="true"
          />
          {{ summary.status.label }}
        </strong>{{ ' ' }}
        <span :class="DETAIL">{{ statusDetail }}</span>{{ ' ' }}
        <span
          v-if="summary.status.reason"
          class="text-xs break-words"
          :class="statusIsBad ? 'text-destructive' : 'text-muted-foreground'"
          data-summary-reason
        >
          {{ summary.status.reason }}
        </span>
        <span
          v-else-if="runtimeOffline"
          class="text-xs text-orange-700"
          data-summary-reason
        >
          Runtime offline: the pod is up but has not connected to the bridle hub yet.
        </span>
      </div>

      <!-- Spend, 30 days -->
      <div
        class="border-l"
        :class="CELL"
        data-summary-cell="spend"
        :data-state="spendLoading ? 'loading' : summary.spend.state"
      >
        <span :class="LABEL">Spend, 30 days</span>{{ ' ' }}
        <template v-if="spendLoading">
          <Skeleton class="h-6 w-20 motion-reduce:animate-none" />
          <span class="sr-only">Loading</span>
        </template>
        <template v-else-if="summary.spend.state === 'ok'">
          <strong :class="FIGURE">{{ formatMoney(summary.spend.costUsd) }}</strong>{{ ' ' }}
          <span :class="DETAIL">
            {{ formatNumber(summary.spend.calls) }}
            {{ summary.spend.calls === 1 ? 'call' : 'calls' }}
            · {{ formatCompact(summary.spend.inputTokens) }} tokens in
          </span>
        </template>
        <span v-else class="text-[13px] text-muted-foreground">{{ summary.spend.text }}</span>
      </div>

      <!-- Pod load -->
      <div
        class="border-t @[640px]:border-l @[640px]:border-t-0"
        :class="CELL"
        data-summary-cell="pod"
        :data-state="podLoading ? 'loading' : summary.pod.state"
      >
        <span :class="LABEL">Pod load</span>{{ ' ' }}
        <template v-if="podLoading">
          <Skeleton class="h-6 w-full motion-reduce:animate-none" />
          <span class="sr-only">Loading</span>
        </template>
        <template v-else-if="summary.pod.state === 'ok'">
          <div class="grid gap-1" data-summary-meter="cpu">
            <div class="flex items-baseline justify-between gap-2 text-xs">
              <span class="text-muted-foreground">CPU</span>
              <span class="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
                {{ summary.pod.cpu ? cpuText(summary.pod.cpu) : 'no limit reported' }}
              </span>
            </div>
            <div
              v-if="summary.pod.cpu"
              class="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="CPU in use"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="summary.pod.cpu.pct"
            >
              <div
                class="h-full rounded-full"
                :class="usagePctClass(summary.pod.cpu.pct)"
                :style="{ width: Math.max(1, summary.pod.cpu.pct) + '%' }"
              />
            </div>
          </div>
          <div class="grid gap-1" data-summary-meter="memory">
            <div class="flex items-baseline justify-between gap-2 text-xs">
              <span class="text-muted-foreground">Memory</span>
              <span class="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">
                {{ summary.pod.memory ? memoryText(summary.pod.memory) : 'no limit reported' }}
              </span>
            </div>
            <div
              v-if="summary.pod.memory"
              class="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Memory in use"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="summary.pod.memory.pct"
            >
              <div
                class="h-full rounded-full"
                :class="usagePctClass(summary.pod.memory.pct)"
                :style="{ width: Math.max(1, summary.pod.memory.pct) + '%' }"
              />
            </div>
          </div>
        </template>
        <span v-else class="text-[13px] text-muted-foreground">{{ summary.pod.text }}</span>
      </div>

      <!-- Requests, last minute -->
      <div
        class="border-l border-t @[640px]:border-t-0"
        :class="CELL"
        data-summary-cell="requests"
        :data-state="requestsLoading ? 'loading' : summary.requests.state"
        :data-used="summary.requests.state === 'ok' ? summary.requests.used : ''"
        :data-limit="summary.requests.state === 'ok' ? (summary.requests.limit ?? '') : ''"
      >
        <span :class="LABEL">Requests, last minute</span>{{ ' ' }}
        <template v-if="requestsLoading">
          <Skeleton class="h-6 w-24 motion-reduce:animate-none" />
          <span class="sr-only">Loading</span>
        </template>
        <template v-else-if="summary.requests.state === 'ok'">
          <strong :class="FIGURE">
            {{ formatNumber(summary.requests.used) }}
            <span class="text-[13px] font-normal text-muted-foreground">
              {{ summary.requests.limitText }}
            </span>
          </strong>{{ ' ' }}
          <span
            :class="[DETAIL, summary.requests.refusedThisHour > 0 && 'text-destructive']"
          >
            {{ summary.requests.detail }}
          </span>
        </template>
        <span v-else class="text-[13px] text-muted-foreground">{{ summary.requests.text }}</span>
      </div>
    </section>
  </div>
</template>
