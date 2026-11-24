<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'
import type { IBridleThinkingStep, IThinkingBlock } from '../../stores/bridle'
import { renderMarkdown } from '../../utils/markdown'
import DelegationStep from './DelegationStep.vue'

/**
 * One segment of the agent's thinking timeline (CLEAN-10): a shimmering
 * "… is thinking…" status while the turn runs, the steps underneath, and once
 * the turn is over a quiet row that re-opens to review what was done. The live
 * chat and the chat history (CLEAN-242) both draw it, so a replayed turn looks
 * the way it did live.
 *
 * The `step` slot lets a host draw steps of its own kind — the history puts
 * its tool rows there. It is used for the ids in `ownSteps` only; every other
 * step gets the default row.
 */
const props = defineProps<{
  block: IThinkingBlock
  /** The status while the turn runs, e.g. "Ranch is thinking…". */
  label: string
  ownSteps?: ReadonlySet<string>
}>()

defineSlots<{
  step?: (props: { step: IBridleThinkingStep }) => unknown
}>()

const isThinking = computed(() => props.block.status === 'thinking')

// Unset = open while thinking, collapsed when done.
const collapsedOverride = ref<boolean | null>(null)
const collapsed = computed(() => collapsedOverride.value ?? !isThinking.value)
function toggleBlock(): void {
  collapsedOverride.value = !collapsed.value
}

// stepId → detail expanded; steps arrive collapsed.
const expandedSteps = ref<Record<string, boolean>>({})
function toggleStep(s: IBridleThinkingStep): void {
  expandedSteps.value[s.id] = !expandedSteps.value[s.id]
}
</script>

<template>
  <div
    class="mr-auto flex max-w-full flex-col gap-1.5 px-1"
    :role="isThinking ? 'status' : undefined"
    :aria-label="isThinking ? label : undefined"
  >
    <div class="flex items-center gap-1.5">
      <span
        :class="['text-sm font-medium text-muted-foreground', isThinking && 'shimmer shimmer-duration-1600']"
      >{{ isThinking ? label : 'Thought for a moment' }}</span>
      <button
        v-if="block.steps.length"
        type="button"
        class="p-0.5 text-muted-foreground"
        :aria-expanded="!collapsed"
        aria-label="Toggle thinking details"
        @click="toggleBlock"
      >
        <ChevronDown :class="cn('h-3.5 w-3.5 transition-transform', collapsed && '-rotate-90')" />
      </button>
    </div>
    <div
      v-if="block.steps.length && !collapsed"
      class="ml-1 flex flex-col gap-0.5 border-l border-border pl-3"
    >
      <div
        v-for="s in block.steps"
        :key="s.id"
        class="flex flex-col items-start"
      >
        <slot v-if="ownSteps?.has(s.id)" name="step" :step="s" />
        <template v-else>
          <!-- A delegation is a step like any other on the wire, so
               every surface still shows it. Here it gets the layout
               it earns: who was asked, what their card promised,
               why they were picked, and a clock while we wait. -->
          <DelegationStep
            v-if="s.kind === 'delegation' && s.delegation"
            :step="s"
          />
          <button
            v-else-if="s.detail"
            type="button"
            class="flex items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground"
            :aria-expanded="!!expandedSteps[s.id]"
            :aria-controls="`bridle-admin-step-${s.id}`"
            @click="toggleStep(s)"
          >
            <span :class="s.state === 'active' ? 'shimmer shimmer-duration-1600 text-foreground' : ''">{{ s.label }}</span>
            <ChevronDown :class="cn('h-3 w-3 shrink-0 transition-transform', !expandedSteps[s.id] && '-rotate-90')" />
          </button>
          <div v-else class="py-0.5 text-[13px] text-muted-foreground">
            <span :class="s.state === 'active' ? 'shimmer shimmer-duration-1600 text-foreground' : ''">{{ s.label }}</span>
          </div>
          <!-- Not for a delegation: its own layout already shows
               everything the markdown detail repeats for surfaces
               that have no layout of their own. -->
          <div
            v-if="s.kind !== 'delegation' && s.detail && expandedSteps[s.id]"
            :id="`bridle-admin-step-${s.id}`"
            class="chat-md mb-1.5 max-w-full border-l-2 border-border pl-2 text-[13px] leading-relaxed text-muted-foreground wrap-anywhere"
            v-html="renderMarkdown(s.detail)"
          />
        </template>
      </div>
    </div>
  </div>
</template>
