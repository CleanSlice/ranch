<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ agent.name }}</h1>
      <span
        class="px-2 py-1 rounded text-sm"
        :class="statusClass"
      >
        {{ statusKey ? $t(statusKey) : agent.status }}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-muted-foreground">{{ $t('item.template') }}</p>
        <p>{{ agent.templateId }}</p>
      </div>
      <div>
        <p class="text-sm text-muted-foreground">{{ $t('item.resources') }}</p>
        <p>
          {{
            $t('item.resources_value', {
              cpu: agent.resources.cpu,
              memory: agent.resources.memory,
            })
          }}
        </p>
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

// A status the console knows is shown through its key. One it does not know —
// the runtime can add them — is shown as received rather than hidden.
const STATUS_KEYS: Record<string, string> = {
  running: 'status.running',
  pending: 'status.pending',
  deploying: 'status.deploying',
  failed: 'status.failed',
  stopped: 'status.stopped',
};
const statusKey = computed(() => STATUS_KEYS[props.agent.status] ?? null);

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
