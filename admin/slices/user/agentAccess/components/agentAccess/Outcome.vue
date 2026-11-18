<script setup lang="ts">
import { outcomeSentence, type IAccessOutcome } from '#agentAccess/utils/outcome';

/**
 * What the account's lists come to, in one sentence (FR-020). While the
 * person has choices they have not saved, it is the sentence the save would
 * produce, and it says so.
 */
const props = defineProps<{
  outcome: IAccessOutcome;
  /** The sentence is about unsaved choices. */
  pending?: boolean;
}>();

const sentence = computed(() => outcomeSentence(props.outcome));
const tone = computed(() => {
  if (props.outcome.kind === 'none') return 'text-amber-700 dark:text-amber-400';
  return 'text-foreground';
});
</script>

<template>
  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
    <span v-if="pending" class="text-xs text-muted-foreground" data-access-pending>
      After saving:
    </span>
    <p
      class="text-sm font-medium"
      :class="tone"
      :data-access-outcome="outcome.kind"
      aria-live="polite"
    >
      {{ sentence }}
    </p>
  </div>
</template>
