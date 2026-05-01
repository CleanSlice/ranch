<script setup lang="ts">
const agentStore = useAgentStore();
const authStore = useAuthStore();

const canCreate = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

const { data: agents, pending } = await useAsyncData(
  'agents',
  () => agentStore.fetchAll(),
);

const runningCount = computed(
  () => (agents.value ?? []).filter((a) => a.status === 'running').length,
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Agents</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Click a card to chat. Live runtime status updates as agents come online.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <div
          v-if="agents?.length"
          class="hidden sm:flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"
        >
          <span class="relative flex h-2 w-2">
            <span
              v-if="runningCount > 0"
              class="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping"
            />
            <span
              class="relative inline-flex h-2 w-2 rounded-full"
              :class="runningCount > 0 ? 'bg-emerald-500' : 'bg-muted-foreground'"
            />
          </span>
          <span class="font-medium text-foreground">{{ runningCount }}</span>
          / {{ agents.length }} running
        </div>

        <NuxtLink
          v-if="canCreate"
          to="/agents/create"
          class="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-sm hover:opacity-95 transition"
        >
          <Icon name="plus" :size="14" />
          Create Agent
        </NuxtLink>
      </div>
    </header>

    <!-- Loading skeletons (initial load only — refresh keeps existing list visible) -->
    <div
      v-if="pending && !agents?.length"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="flex flex-col rounded-xl border bg-card p-5"
      >
        <div class="flex items-start gap-4">
          <div class="h-12 w-12 shrink-0 rounded-lg bg-muted animate-pulse" />
          <div class="flex-1 space-y-2">
            <div class="h-4 w-32 rounded bg-muted animate-pulse" />
            <div class="h-3 w-48 rounded bg-muted/70 animate-pulse" />
          </div>
        </div>
        <div class="mt-5 h-3 w-24 rounded bg-muted/70 animate-pulse" />
      </div>
    </div>

    <div
      v-else-if="agents?.length"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <AgentListCard
        v-for="agent in agents"
        :key="agent.id"
        :agent="agent"
      />
    </div>

    <div
      v-else
      class="rounded-xl border border-dashed bg-card/40 p-12 text-center"
    >
      <div
        class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon name="bot" :size="22" />
      </div>
      <h2 class="mt-4 text-base font-semibold">No agents yet</h2>
      <p class="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        Spin up your first AI worker — it'll appear here and you can chat with
        it in real time.
      </p>
      <NuxtLink
        v-if="canCreate"
        to="/agents/create"
        class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-95 transition"
      >
        <Icon name="plus" :size="14" />
        Create your first agent
      </NuxtLink>
      <p
        v-else
        class="mt-5 text-xs text-muted-foreground/70"
      >
        Ask an Admin or Owner to deploy one.
      </p>
    </div>
  </div>
</template>
