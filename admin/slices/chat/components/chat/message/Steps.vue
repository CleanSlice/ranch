<script setup lang="ts">
import BridleThinking from '#bridle/components/bridle/Thinking.vue';
import type { IThinkingBlock } from '#bridle/stores/bridle';
import type { IToolEvent } from '#chat/utils/transcript';

// What led up to an assistant reply (see groupTranscript). With narration it
// is the live chat's thinking block (CLEAN-242), the tool rows sitting in it
// in the order they ran; without, the tool rows alone.
const props = defineProps<{
  tools: IToolEvent[];
  thinking: IThinkingBlock | null;
}>();

const toolById = computed(() => new Map(props.tools.map((t) => [t.id, t])));
const toolIds = computed(() => new Set(toolById.value.keys()));
</script>

<template>
  <BridleThinking
    v-if="thinking"
    :block="thinking"
    label="Thinking…"
    :own-steps="toolIds"
  >
    <template #step="{ step }">
      <ChatMessageToolEvents :tools="[toolById.get(step.id)!]" class="w-full py-0.5" />
    </template>
  </BridleThinking>
  <ChatMessageToolEvents v-else-if="tools.length" :tools="tools" />
</template>
