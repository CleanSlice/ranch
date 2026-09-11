<script setup lang="ts">
import {
  BridleThinkingBlockStates,
  BridleThinkingStepStates,
  type IBridleThinkingBlock,
  type IBridleThinkingStep,
} from '#bridle/stores/bridle';
import { renderMarkdown } from '#bridle/utils/markdown';

/**
 * One segment of the agent's thinking timeline (CLEAN-76): a shimmering
 * "«Agent» is thinking…" status while the turn runs, a list of the steps the
 * agent published underneath, and — once the turn is over — a single quiet
 * summary row that can be re-opened to review what was done.
 *
 * Steps stay collapsed (label only) until the person opens one; the active
 * step shimmers so the eye lands on what is happening right now.
 */
const props = defineProps<{
  block: IBridleThinkingBlock;
  agentName: string;
}>();

const isThinking = computed(
  () => props.block.state === BridleThinkingBlockStates.Thinking,
);

/**
 * Open while thinking, folded once done — unless the person decided
 * otherwise. `null` means "no decision yet", so the default can flip when the
 * block finishes without fighting a click that already happened.
 */
const collapsedOverride = ref<boolean | null>(null);
const collapsed = computed(() =>
  collapsedOverride.value === null
    ? !isThinking.value
    : collapsedOverride.value,
);

function toggleBlock() {
  collapsedOverride.value = !collapsed.value;
}

const expandedSteps = ref<Record<string, boolean>>({});

function toggleStep(step: IBridleThinkingStep) {
  expandedSteps.value[step.id] = !expandedSteps.value[step.id];
}

function isActive(step: IBridleThinkingStep): boolean {
  return step.state === BridleThinkingStepStates.Active;
}

const statusKey = computed(() =>
  isThinking.value ? 'chat.thinking' : 'chat.thought',
);
</script>

<template>
  <div
    class="flex max-w-[85%] flex-col gap-1.5 px-1 sm:max-w-[75%]"
    :role="isThinking ? 'status' : undefined"
    :aria-label="isThinking ? $t('chat.thinking', { name: agentName }) : undefined"
  >
    <div class="flex items-center gap-1.5">
      <span
        class="text-sm font-medium text-muted-foreground"
        :class="isThinking && 'shimmer shimmer-duration-1600'"
      >{{ $t(statusKey, { name: agentName }) }}</span>
      <button
        v-if="block.steps.length"
        type="button"
        class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        :aria-expanded="!collapsed"
        :aria-label="$t('chat.thinking_toggle')"
        @click="toggleBlock"
      >
        <Icon
          name="chevron-down"
          :size="14"
          :class="collapsed ? 'transition-transform -rotate-90' : 'transition-transform'"
        />
      </button>
    </div>

    <!-- The timeline: a thin rule with the steps hanging off it -->
    <div
      v-if="block.steps.length && !collapsed"
      class="ml-1 flex flex-col gap-0.5 border-l border-border pl-3"
    >
      <div
        v-for="step in block.steps"
        :key="step.id"
        class="flex flex-col items-start"
      >
        <button
          v-if="step.detail"
          type="button"
          class="flex items-center gap-1.5 py-0.5 text-left text-[13px] text-muted-foreground"
          :aria-expanded="!!expandedSteps[step.id]"
          :aria-controls="`bridle-step-${step.id}`"
          @click="toggleStep(step)"
        >
          <span :class="isActive(step) && 'shimmer shimmer-duration-1600 text-foreground'">{{ step.label }}</span>
          <Icon
            name="chevron-down"
            :size="12"
            :class="expandedSteps[step.id] ? 'shrink-0 transition-transform' : 'shrink-0 transition-transform -rotate-90'"
          />
        </button>
        <div v-else class="py-0.5 text-[13px] text-muted-foreground">
          <span :class="isActive(step) && 'shimmer shimmer-duration-1600 text-foreground'">{{ step.label }}</span>
        </div>
        <div
          v-if="step.detail && expandedSteps[step.id]"
          :id="`bridle-step-${step.id}`"
          class="chat-md mb-1.5 max-w-full border-l-2 border-border pl-2 text-[13px] leading-relaxed text-muted-foreground wrap-anywhere"
          v-html="renderMarkdown(step.detail)"
        />
      </div>
    </div>
  </div>
</template>
