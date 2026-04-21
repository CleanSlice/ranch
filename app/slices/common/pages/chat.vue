<template>
  <div class="h-[calc(100vh-3.5rem-3rem)] -my-6">
    <div class="grid grid-cols-[18rem_1fr] h-full border rounded-lg overflow-hidden bg-background">
      <aside class="border-r flex flex-col bg-muted/30">
        <div class="px-4 py-3 border-b flex items-center justify-between">
          <h2 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Agents
          </h2>
          <NuxtLink
            to="/agents/create"
            class="text-xs text-primary hover:underline"
          >
            + New
          </NuxtLink>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div v-if="agentStore.loading" class="p-4 text-sm text-muted-foreground">
            Loading…
          </div>
          <div
            v-else-if="agentStore.error"
            class="p-4 text-sm text-red-600"
          >
            {{ agentStore.error }}
          </div>
          <div
            v-else-if="!agentStore.agents.length"
            class="p-4 text-sm text-muted-foreground"
          >
            No agents yet.
          </div>
          <ul v-else class="divide-y">
            <li v-for="agent in agentStore.agents" :key="agent.id">
              <button
                type="button"
                class="w-full text-left px-4 py-3 hover:bg-accent transition-colors flex items-center justify-between"
                :class="{ 'bg-accent': selectedId === agent.id }"
                @click="selectedId = agent.id"
              >
                <div class="min-w-0">
                  <div class="font-medium truncate">{{ agent.name }}</div>
                  <div class="text-xs text-muted-foreground truncate">
                    {{ agent.templateId }}
                  </div>
                </div>
                <span
                  class="shrink-0 ml-2 px-2 py-0.5 rounded text-[10px] uppercase"
                  :class="statusClass(agent.status)"
                >
                  {{ agent.status }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <section class="min-w-0">
        <BridleChatProvider
          :bot-id="selectedId"
          :title="selectedAgent?.name"
          :subtitle="selectedAgent?.templateId"
        />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
const agentStore = useAgentStore();

await useAsyncData('agent-list', () => agentStore.fetchAll());

const selectedId = ref<string | null>(null);

const selectedAgent = computed(
  () => agentStore.agents.find((a) => a.id === selectedId.value) ?? null,
);

watch(
  () => agentStore.agents,
  (list) => {
    if (!selectedId.value && list.length) {
      selectedId.value = list[0].id;
    }
  },
  { immediate: true },
);

function statusClass(status: string) {
  const map: Record<string, string> = {
    running: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    deploying: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800',
  };
  return map[status] || 'bg-gray-100 text-gray-800';
}
</script>
