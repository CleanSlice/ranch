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

// Cluster headroom — fetched only for roles that can act on it (also avoids
// 403 noise for plain users). Store actions (create/remove/restart) refetch
// on their own; the interval catches everyone else's changes and pods
// actually scheduling. The backend caches ~15s, so polling is cheap.
const capacity = computed(() => agentStore.capacity);

let capacityTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  if (!canCreate.value) return;
  void agentStore.fetchCapacity();
  capacityTimer = setInterval(() => void agentStore.fetchCapacity(), 30_000);
});
onUnmounted(() => {
  if (capacityTimer) clearInterval(capacityTimer);
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">{{ $t('list.title') }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ $t('list.lede') }}
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
          <!-- The running count keeps its own emphasis, so it comes in as a
               slot rather than a plain parameter — the sentence stays one
               translatable string either way. -->
          <i18n-t keypath="list.running_of" tag="span">
            <template #running>
              <span class="font-medium text-foreground">{{ runningCount }}</span>
            </template>
            <template #total>{{ agents.length }}</template>
          </i18n-t>
          <template v-if="canCreate && capacity">
            <span class="text-muted-foreground/60">·</span>
            <span
              :class="
                capacity.freeAgentSlots === 0
                  ? 'font-medium text-amber-600'
                  : ''
              "
            >
              {{
                $t(
                  'list.slots_free',
                  { count: capacity.freeAgentSlots },
                  capacity.freeAgentSlots,
                )
              }}
            </span>
          </template>
        </div>

        <NuxtLink
          v-if="canCreate"
          to="/agents/create"
          class="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-sm hover:opacity-95 transition"
        >
          <Icon name="plus" :size="14" />
          {{ $t('list.create') }}
        </NuxtLink>
      </div>
    </header>

    <!-- Capacity is a ~15s-stale estimate, so this warns rather than blocks:
         creating is still legal, the pod just waits Pending for a slot. -->
    <div
      v-if="canCreate && capacity?.freeAgentSlots === 0"
      class="flex items-center gap-1.5 text-xs text-amber-600"
    >
      <Icon name="alert-triangle" :size="14" class="shrink-0" />
      {{
        $t(
          capacity.totalAgentSlots === 0
            ? 'list.cluster_no_nodes'
            : 'list.cluster_full',
        )
      }}
    </div>

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
      <h2 class="mt-4 text-base font-semibold">{{ $t('list.empty_title') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        {{ $t('list.empty_hint') }}
      </p>
      <NuxtLink
        v-if="canCreate"
        to="/agents/create"
        class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-95 transition"
      >
        <Icon name="plus" :size="14" />
        {{ $t('list.empty_cta') }}
      </NuxtLink>
      <p
        v-else
        class="mt-5 text-xs text-muted-foreground/70"
      >
        {{ $t('list.empty_no_permission') }}
      </p>
    </div>
  </div>
</template>
