<template>
  <div v-if="pending">Loading agent...</div>
  <div v-else-if="error">Error loading agent</div>
  <div v-else-if="agent">
    <AgentItem :agent="agent" />
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const agentStore = useAgentStore();

const { data: agent, pending, error } = await useAsyncData(
  `agent-${route.params.id}`,
  () => agentStore.fetchById(route.params.id as string),
);
</script>
