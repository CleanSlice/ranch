<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Agents</h1>
      <NuxtLink to="/agents/create" class="btn-primary">
        Create Agent
      </NuxtLink>
    </div>
    <div v-if="pending">Loading agents...</div>
    <div v-else-if="agents?.length" class="grid gap-4">
      <AgentListThumb
        v-for="agent in agents"
        :key="agent.id"
        :agent="agent"
      />
    </div>
    <div v-else class="text-muted-foreground">No agents yet.</div>
  </div>
</template>

<script setup lang="ts">
const agentStore = useAgentStore();

const { data: agents, pending } = await useAsyncData(
  'agents',
  () => agentStore.fetchAll(),
);
</script>
