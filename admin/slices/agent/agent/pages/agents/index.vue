<script setup lang="ts">
// There is no agents table any more (FR-008). This route is a resolver: it
// picks the agent to land on and hands over to the canonical
// `/agents/:id` address, which is what keeps deep links, sharing and the
// back button working. It only renders when there is nothing to land on.
//
// `replace: true` keeps `/agents` out of the history stack — Back from an
// agent should leave the agents area, not bounce through the resolver.
const agentStore = useAgentStore();

const { data: agents, pending } = await useAsyncData('admin-agents', () =>
  agentStore.fetchAll(),
);

const landing = computed(() => {
  const list = agents.value ?? [];
  if (!list.length) return null;
  // The Ranch admin agent is the one an operator almost always wants: it is
  // the agent that can act on the rest of the install.
  const rancher = list.find((a) => a.isAdmin);
  if (rancher) return rancher;
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
});

watchEffect(() => {
  if (landing.value) {
    void navigateTo(`/agents/${landing.value.id}`, { replace: true });
  }
});
</script>

<template>
  <div v-if="pending && !agents?.length" class="flex flex-col gap-3">
    <Skeleton class="h-8 w-48" />
    <Skeleton class="h-64 w-full rounded-lg" />
  </div>

  <div
    v-else-if="!landing"
    class="rounded-lg border border-dashed p-12 text-center"
  >
    <h1 class="text-base font-semibold">No agents yet</h1>
    <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
      Deploy an agent and this becomes its workspace — chat on the left,
      settings on the right.
    </p>
    <Button class="mt-5" as-child>
      <NuxtLink to="/agents/create">Create your first agent</NuxtLink>
    </Button>
  </div>
</template>
