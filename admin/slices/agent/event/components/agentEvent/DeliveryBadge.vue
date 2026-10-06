<script setup lang="ts">
import type { IIncidentNotification } from '#agentEvent/domain';
import { TONE_CLASSES, deliveryState } from '#agentEvent/utils/eventTone';

// Whether the team was told about an incident. Renders nothing when there is
// no notification row — an empty cell, not a guess.
const props = defineProps<{
  notifications: readonly IIncidentNotification[] | null | undefined;
}>();

const state = computed(() => deliveryState(props.notifications));
</script>

<template>
  <!-- The delivery error is the server's text: on hover, as received. -->
  <Badge
    v-if="state"
    variant="outline"
    :class="TONE_CLASSES[state.tone]"
    :title="state.detail"
  >
    {{ state.label }}
  </Badge>
</template>
