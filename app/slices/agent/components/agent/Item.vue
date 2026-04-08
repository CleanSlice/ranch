<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ agent.name }}</h1>
      <span
        class="px-2 py-1 rounded text-sm"
        :class="statusClass"
      >
        {{ agent.status }}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-muted-foreground">Template</p>
        <p>{{ agent.templateId }}</p>
      </div>
      <div>
        <p class="text-sm text-muted-foreground">Resources</p>
        <p>CPU: {{ agent.resources.cpu }} / Memory: {{ agent.resources.memory }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  agent: {
    name: string;
    status: string;
    templateId: string;
    resources: { cpu: string; memory: string };
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
