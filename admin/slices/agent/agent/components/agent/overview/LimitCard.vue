<script setup lang="ts">
/**
 * Request limit (CLEAN-228, User Story 4): the switch, the three limits of
 * CLEAN-224, and under them the agent's own last hour — so a number is chosen
 * by looking at what it would have done, not by guessing. The line across the
 * chart and the sentence under it follow the per-minute field as it is typed;
 * nothing is sent until the page's bar saves.
 *
 * The rules are unchanged and live on the server: off by default, a public
 * agent needs at least one, a longer window is never lower than a shorter
 * one. One allowance per agent, a refusal with a wait: no per-user mode, no
 * holding of requests, no installation-wide default.
 *
 * The limits, the load and the "public without limits" flag are the limit
 * store's record for this agent (docs/state.md); the fields are the page's
 * draft. This block keeps that record fresh — the job of the two CLEAN-224
 * cards it replaces, the request-load one and the visibility one — and holds
 * nothing but the text being typed and "switched on, nothing typed yet".
 */
import { IconAlertTriangle, IconGauge, IconInfoCircle } from '@tabler/icons-vue'
import type { LimitWindowTypes } from '#agent/domain/agentLimit.types'
import {
  useInjectedAgentDraft,
  type IDraftError,
} from '#agent/composables/useAgentDraft'
import { agentInitials } from '#agent/composables/useAgentRailEntries'
import { LIMIT_FIELDS, limitTextToNumber } from '#agent/utils/agentLimitForm'
import { limitPreview, verdictText } from '#agent/utils/limitPreview'
import { formatNumber } from '#common/utils/format'

const props = defineProps<{ agentId: string }>()

const draft = useInjectedAgentDraft()
const { errors, saving, limitsKnown } = draft

const agentStore = useAgentStore()
const limitStore = useAgentLimitStore()

const agent = computed(() => agentStore.byId(props.agentId))
const uid = useId()

// ── What is saved ────────────────────────────────────────────────────
const limitEntry = computed(() => limitStore.byAgent[props.agentId])
// `undefined`: not read yet. `null`: read, and limits are off.
const savedLimits = computed(() => limitEntry.value?.limits)
const load = computed(() => limitEntry.value?.load ?? null)
const peaks = computed(() => load.value?.peaks ?? null)

// Public before limits existed (CLEAN-224, case 8): it keeps working
// uncapped, and this block says so until someone sets a limit.
const needsLimits = computed(
  () =>
    limitEntry.value?.needsLimits === true ||
    (agent.value?.isPublic === true && savedLimits.value === null),
)

const limitsLoadError = ref<string | null>(null)

// Limits and load are two reads on purpose: the limits are what Save needs,
// the load only adds the last hour and the peaks. A failed load must not
// block the fields.
async function loadLimits() {
  limitsLoadError.value = null
  const [limits] = await Promise.allSettled([
    limitStore.fetchLimits(props.agentId),
    limitStore.fetchLoad(props.agentId),
  ])
  if (limits.status === 'rejected' && !limitsKnown.value) {
    limitsLoadError.value =
      (limits.reason as Error)?.message || 'Could not load the limits'
  }
}

// Every 3 s while this block is mounted AND the tab is visible (CLEAN-224,
// FR-046): the store stops the timer in a hidden tab and asks again the
// moment it is shown. Counted — the summary strip watches the same record.
let stopWatching: (() => void) | null = null
onMounted(() => {
  void loadLimits()
  stopWatching = limitStore.watchLoad(props.agentId)
  scrollIfLinkedTo()
})
onBeforeUnmount(() => {
  stopWatching?.()
  stopWatching = null
  if (scrollTimer) clearTimeout(scrollTimer)
})

// The chat's "Limits" link lands here by anchor. The block is rendered after
// the route settles, so the browser's own jump has nothing to jump to — and
// when Overview is already open, only the hash changes. Asked twice: the
// blocks above this one grow as their data arrives.
const route = useRoute()
let scrollTimer: ReturnType<typeof setTimeout> | null = null
function scrollToSelf() {
  document.getElementById('visibility-embed')?.scrollIntoView({ block: 'start' })
}
function scrollIfLinkedTo() {
  if (route.hash !== '#visibility-embed') return
  void nextTick(scrollToSelf)
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (route.hash === '#visibility-embed') scrollToSelf()
  }, 500)
}
watch(() => route.hash, scrollIfLinkedTo)

// ── The fields ───────────────────────────────────────────────────────
// A text field cannot be driven by the draft's value alone: "20 " and "20"
// are the same limit, and re-rendering the parsed value would eat what is
// being typed. Each field remembers its own text and shows it for as long as
// it still parses to what the draft holds.
type LimitField = (typeof LIMIT_FIELDS)[number]

const typedLimits = reactive<Record<LimitWindowTypes, string | null>>({
  minute: null,
  hour: null,
  day: null,
})

function limitText(field: LimitField): string {
  const held = draft.value(field.key)
  const own = typedLimits[field.window]
  // `Object.is`: text that is not a number is held as NaN, and stays shown.
  if (own !== null && Object.is(limitTextToNumber(own), held)) return own
  return held === null || Number.isNaN(held) ? '' : String(held)
}

function setLimitText(field: LimitField, value: string) {
  typedLimits[field.window] = value
  draft.set(field.key, limitTextToNumber(value))
}

function onLimitInput(field: LimitField, event: Event) {
  setLimitText(field, (event.target as HTMLInputElement).value)
}

function limitError(field: LimitField): IDraftError | null {
  return errors.value[field.key] ?? null
}

const limitsEmpty = computed(
  () =>
    draft.value('perMinute') === null &&
    draft.value('perHour') === null &&
    draft.value('perDay') === null,
)

const limitsChanged = computed(
  () =>
    draft.changed('perMinute') ||
    draft.changed('perHour') ||
    draft.changed('perDay'),
)

// ── The switch ───────────────────────────────────────────────────────
// A view of the three fields: off IS "all three empty", which is what
// "limits off" has meant since CLEAN-224. Switched on with nothing typed yet
// is the one thing the fields cannot say, so it is remembered here — until a
// discard, or a save that left the limits off.
const armed = ref(false)
const on = computed(() => !limitsEmpty.value || armed.value)

watch(draft.resets, () => {
  armed.value = false
})
watch(saving, (now, before) => {
  if (before && !now && limitsEmpty.value) armed.value = false
})

function setOn(next: boolean) {
  if (next) {
    armed.value = true
    void nextTick(() => {
      document.getElementById(`${uid}-minute`)?.focus()
    })
    return
  }
  armed.value = false
  typedLimits.minute = null
  typedLimits.hour = null
  typedLimits.day = null
  draft.set('perMinute', null)
  draft.set('perHour', null)
  draft.set('perDay', null)
}

// Said before the save refuses it: either this goes back on, or the agent
// goes private in Access.
const publicWithoutLimits = computed(
  () => draft.value('isPublic') && limitsEmpty.value && !errors.value.limits,
)

// ── Presets ──────────────────────────────────────────────────────────
// Shortcuts for typing, for the per-minute limit only. Not a recommendation:
// the basis for choosing is the agent's own busiest minute, beside the field.
const PRESETS = [10, 30, 60, 120] as const
const minuteField = LIMIT_FIELDS[0]!

function applyPreset(value: number) {
  setLimitText(minuteField, String(value))
}

const PEAK_TITLES: Record<LimitWindowTypes, string> = {
  minute: 'Most requests accepted in any one minute of the last 30 days',
  hour: 'Most requests accepted in any 60 minutes of the last 30 days',
  day: 'Most requests accepted in any 24 hours of the last 30 days',
}

// ── The last hour against what is typed ──────────────────────────────
const previewLimit = computed<number | null>(() => {
  if (!on.value) return null
  const value = draft.value('perMinute')
  return typeof value === 'number' && Number.isFinite(value) ? value : null
})

const preview = computed(() =>
  limitPreview(load.value?.series ?? [], previewLimit.value),
)

const verdict = computed(() => {
  // Hour or day limits without a per-minute one: there IS a limit, only not
  // one this chart can be held against.
  if (on.value && previewLimit.value === null && !limitsEmpty.value) {
    return `No limit per minute. Peak in this hour was ${formatNumber(preview.value.peak)} per minute.`
  }
  return verdictText({
    on: on.value,
    perMinute: previewLimit.value,
    peak: preview.value.peak,
    over: preview.value.over,
    refused: preview.value.refused,
  })
})

const initials = computed(() =>
  agent.value ? agentInitials(agent.value.name, agent.value.id) : '?',
)

const UNIT =
  'inline-flex items-center overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50'
const UNIT_INPUT =
  'h-8 w-[82px] min-w-0 bg-transparent px-2.5 text-[13.5px] tabular-nums outline-none disabled:opacity-50 @max-[460px]:w-16'
const UNIT_LABEL =
  'grid h-8 place-items-center border-l bg-muted px-2.5 text-xs whitespace-nowrap text-muted-foreground'
const CHANGED = 'border-amber-500/70 ring-2 ring-amber-500/45'
const INVALID = 'border-destructive'
const CALM_SWITCH =
  'motion-reduce:transition-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none'
</script>

<template>
  <section
    id="visibility-embed"
    class="scroll-mt-4 rounded-xl border bg-card"
    data-block="limit"
    :data-on="on ? 'true' : 'false'"
  >
    <header class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-5 pt-4">
      <IconGauge class="size-4 shrink-0" aria-hidden="true" />
      <h2 class="text-[15px] font-semibold">Request limit</h2>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-[12.5px] text-muted-foreground" aria-hidden="true">
          {{ on ? 'On' : 'Off' }}
        </span>
        <Switch
          :model-value="on"
          :disabled="saving || !limitsKnown"
          aria-label="Limit requests to this agent"
          :class="[CALM_SWITCH, limitsChanged && 'ring-2 ring-amber-500/45']"
          data-limit-switch
          :data-changed="limitsChanged ? '' : undefined"
          @update:model-value="(v: boolean) => setOn(v)"
        />
      </div>
      <p class="basis-full text-[13px] text-muted-foreground">
        Caps how many messages this agent accepts, across chat, embeds and the
        message routes. Everyone who talks to the agent shares one allowance.
      </p>
    </header>

    <div class="flex flex-col gap-3.5 px-5 pb-[18px] pt-2.5">
      <div
        v-if="needsLimits"
        class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900"
        role="status"
        data-limits-needed
      >
        <IconAlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <span class="font-medium">Public without limits.</span>
          This agent was made public before request limits existed and still
          answers without a cap. Set at least one limit here — the next save
          of its limits or its access requires it.
        </p>
      </div>

      <!-- The refusal that is about the switch, not about one field: a
           public agent with no limit at all. Outside the subdued part, so it
           reads at full strength while the fields are off. -->
      <p
        v-if="errors.limits"
        class="text-xs text-destructive"
        role="alert"
        data-limits-error
        :data-limits-error-code="errors.limits.code ?? ''"
      >
        {{ errors.limits.text }}
      </p>
      <p
        v-else-if="publicWithoutLimits && !needsLimits"
        class="text-xs text-amber-800"
        data-limit-public-note
      >
        This agent is public, and a public agent needs at least one limit:
        a save with all three empty is refused.
      </p>

      <!-- Subdued while off, never hidden and never locked: typing a number
           is itself switching the limit on. -->
      <div :class="!on && 'opacity-60'" data-limit-fields>
        <AgentOverviewRow label="Limits">
          <template #hint>An empty field is not limited</template>
          <div class="flex flex-wrap items-start gap-x-3 gap-y-2.5">
            <div
              v-for="field in LIMIT_FIELDS"
              :key="field.window"
              class="grid max-w-full content-start gap-1"
            >
              <span
                :class="[
                  UNIT,
                  draft.changed(field.key) && CHANGED,
                  limitError(field) && INVALID,
                ]"
              >
                <input
                  :id="`${uid}-${field.window}`"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  placeholder="None"
                  :value="limitText(field)"
                  :disabled="saving || !limitsKnown"
                  :aria-label="`Requests ${field.label}`"
                  :aria-invalid="limitError(field) ? 'true' : undefined"
                  :aria-describedby="limitError(field) ? `${uid}-${field.window}-error` : undefined"
                  :class="UNIT_INPUT"
                  :data-limit-input="field.window"
                  :data-changed="draft.changed(field.key) ? '' : undefined"
                  @input="onLimitInput(field, $event)"
                />
                <span :class="UNIT_LABEL" aria-hidden="true">{{ field.label }}</span>
              </span>
              <p
                v-if="peaks"
                class="text-xs text-muted-foreground"
                :title="PEAK_TITLES[field.window]"
                :data-limit-peak="field.window"
              >
                busiest in 30 days: {{ formatNumber(peaks[field.window]) }}
              </p>
              <p
                v-if="limitError(field)"
                :id="`${uid}-${field.window}-error`"
                class="max-w-64 text-xs text-destructive"
                role="alert"
                data-limits-error
                :data-limits-error-code="limitError(field)?.code ?? ''"
              >
                {{ limitError(field)?.text }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Shortcuts for the per-minute limit">
            <span class="text-xs text-muted-foreground">Per minute:</span>
            <button
              v-for="value in PRESETS"
              :key="value"
              type="button"
              class="min-h-7 rounded-full border px-2.5 text-[12.5px] tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              :class="on && draft.value('perMinute') === value
                ? 'border-primary bg-primary font-medium text-primary-foreground'
                : 'bg-background hover:bg-muted'"
              :aria-pressed="on && draft.value('perMinute') === value"
              :disabled="saving || !limitsKnown"
              :data-limit-preset="value"
              @click="applyPreset(value)"
            >
              {{ value }}
            </button>
          </div>

          <p v-if="limitsLoadError" class="text-xs text-destructive" role="alert">
            {{ limitsLoadError }} — the limits cannot be edited until they load.
            <button type="button" class="underline" @click="loadLimits">Retry</button>
          </p>
        </AgentOverviewRow>

        <AgentOverviewRow label="Over the limit">
          <p class="text-[13px] @[460px]:pt-[7px]">
            The message is declined and the person is asked to wait until
            there is room again.
          </p>
          <div
            class="flex items-start gap-2.5 rounded-[10px] border border-dashed px-3 py-2.5 text-[13px]"
            data-limit-preview
          >
            <span
              class="grid size-6 shrink-0 place-items-center rounded-[7px] bg-muted text-[10px] font-semibold"
              aria-hidden="true"
            >
              {{ initials }}
            </span>
            <div class="min-w-0">
              <span class="block text-xs text-muted-foreground">What the person sees in chat</span>
              This agent has reached its message limit. Try again in 0:42.
            </div>
          </div>
        </AgentOverviewRow>
      </div>

      <p class="text-xs text-muted-foreground" data-limits-uncovered>
        Not counted: operators (Owners and Admins, from either console) and
        other agents. Not covered: Telegram and the agent's scheduled runs.
      </p>

      <!-- Right now and the last hour: the limit store's record, as it is. -->
      <div class="grid gap-5 border-t pt-3.5" data-load-view>
        <div v-if="!load" class="space-y-4">
          <Skeleton class="h-12 w-full motion-reduce:animate-none" />
          <Skeleton class="h-32 w-full motion-reduce:animate-none" />
        </div>
        <template v-else>
          <AgentLoadMeters :load="load" />
          <AgentLoadChart
            :series="load.series"
            :per-minute-limit="load.limits?.perMinute ?? null"
            :preview-limit="previewLimit"
          />
        </template>
      </div>

      <div
        v-if="load"
        class="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px]"
        :class="preview.over > 0 ? 'bg-destructive/10 text-red-900' : 'bg-muted'"
        role="status"
        data-limit-verdict
        :data-over="preview.over"
        :data-refused="preview.refused"
      >
        <IconAlertTriangle
          v-if="preview.over > 0"
          class="mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <IconInfoCircle v-else class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{{ verdict }}</span>
      </div>
    </div>
  </section>
</template>
