<template>
  <div v-if="pending">Loading...</div>
  <div v-else-if="agent">
    <slot :agent="agent" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ agentId: string }>();
const agentStore = useAgentStore();

const { data: agent, pending } = await useAsyncData(
  `admin-agent-${props.agentId}`,
  () => agentStore.fetchById(props.agentId),
);
</script>
