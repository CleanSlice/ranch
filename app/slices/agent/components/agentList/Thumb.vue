<template>
  <NuxtLink
    :to="`/agents/${agent.id}`"
    class="block p-4 border rounded-lg hover:bg-accent transition-colors"
  >
    <div class="flex items-center justify-between">
      <div>
        <h3 class="font-medium">{{ agent.name }}</h3>
        <p class="text-sm text-muted-foreground">{{ agent.templateId }}</p>
      </div>
      <span
        class="px-2 py-1 rounded text-xs"
        :class="statusClass"
      >
        {{ agent.status }}
      </span>
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
const props = defineProps<{
  agent: {
    id: string;
    name: string;
    status: string;
    templateId: string;
  };
}>();

const statusClass = computed(() => {
  const map: Record<string, string> = {
    running: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    deploying: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800',
  };
  return map[props.agent.status] || 'bg-gray-100 text-gray-800';
});
</script>
