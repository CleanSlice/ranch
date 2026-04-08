<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">All Agents</h1>
    </div>
    <div v-if="pending">Loading agents...</div>
    <div v-else-if="agents?.length" class="space-y-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="flex items-center justify-between p-4 border rounded-lg"
      >
        <div>
          <span class="font-medium">{{ agent.name }}</span>
          <span class="text-sm text-muted-foreground ml-2">{{ agent.status }}</span>
        </div>
        <div class="flex gap-2">
          <button class="text-sm text-blue-600 hover:underline">Restart</button>
          <button class="text-sm text-red-600 hover:underline">Delete</button>
        </div>
      </div>
    </div>
    <div v-else class="text-muted-foreground">No agents.</div>
  </div>
</template>

<script setup lang="ts">
const agentStore = useAgentStore();

const { data: agents, pending } = await useAsyncData(
  'admin-agents',
  () => agentStore.fetchAll(),
);
</script>
