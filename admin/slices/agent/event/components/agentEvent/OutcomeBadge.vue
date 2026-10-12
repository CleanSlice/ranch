<script setup lang="ts">
import { TONE_CLASSES, outcomeTone } from '#agentEvent/utils/eventTone';

const props = defineProps<{ outcome: string }>();

const tone = computed(() => outcomeTone(props.outcome));
</script>

<template>
  <Badge variant="outline" :class="TONE_CLASSES[tone.tone]">{{ tone.label }}</Badge>
</template>
