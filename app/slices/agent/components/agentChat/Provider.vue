<script setup lang="ts">
const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const authStore = useAuthStore();

const { data: agent, pending, error, refresh } = await useAsyncData(
  `agent-${props.id}`,
  () => agentStore.fetchById(props.id),
);

const canManage = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

const restarting = ref(false);
const restartError = ref<string | null>(null);
/** Wallclock the user clicked Restart — used to compute progress / time. */
const restartStartedAt = ref<number | null>(null);

const TRANSITIONAL_STATUSES = new Set(['pending', 'deploying']);
const isTransitioning = computed(
  () =>
    restarting.value ||
    (agent.value ? TRANSITIONAL_STATUSES.has(agent.value.status) : false),
);

async function onRestart() {
  if (!agent.value || restarting.value) return;
  restarting.value = true;
  restartError.value = null;
  restartStartedAt.value = Date.now();
  const previous = agent.value.status;
  // Optimistic flip — overlay appears immediately, status pill animates.
  agent.value = { ...agent.value, status: 'deploying' };
  try {
    await agentStore.restart(agent.value.id);
    await refresh();
  } catch (err) {
    if (agent.value) agent.value = { ...agent.value, status: previous };
    restartError.value = (err as Error).message || 'Restart failed';
    restartStartedAt.value = null;
  } finally {
    restarting.value = false;
  }
}

// Poll status while the agent is in a transitional state. Stops automatically
// once it's running / failed / stopped. 3s feels responsive without hammering
// the API; matches admin's flow (which uses 5s but also has SSE for finer detail).
let statusTimer: ReturnType<typeof setInterval> | null = null;
function clearStatusTimer() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

watch(
  isTransitioning,
  (active, prev) => {
    if (active) {
      if (!statusTimer) statusTimer = setInterval(() => refresh(), 3000);
    } else {
      clearStatusTimer();
      // Reset the start time when we leave transitional state.
      if (prev) restartStartedAt.value = null;
    }
  },
  { immediate: true },
);
onBeforeUnmount(clearStatusTimer);

// Status meta for the small pill in the header.
const statusMeta = computed(() => {
  const status = agent.value?.status;
  switch (status) {
    case 'running':
      return { label: 'Running', dot: 'bg-emerald-500', pulse: true };
    case 'deploying':
      return { label: 'Deploying', dot: 'bg-amber-500', pulse: true };
    case 'pending':
      return { label: 'Pending', dot: 'bg-amber-500', pulse: true };
    case 'failed':
      return { label: 'Failed', dot: 'bg-rose-500', pulse: false };
    case 'stopped':
      return { label: 'Stopped', dot: 'bg-muted-foreground', pulse: false };
    default:
      return { label: status ?? 'Unknown', dot: 'bg-muted-foreground', pulse: false };
  }
});

// Multi-stage label for the overlay — derived from elapsed time so the user
// can see *something* progressing even though we only have coarse statuses.
const elapsedSec = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

watch(isTransitioning, (active) => {
  if (active) {
    elapsedSec.value = restartStartedAt.value
      ? Math.floor((Date.now() - restartStartedAt.value) / 1000)
      : 0;
    if (!elapsedTimer) {
      elapsedTimer = setInterval(() => {
        elapsedSec.value = restartStartedAt.value
          ? Math.floor((Date.now() - restartStartedAt.value) / 1000)
          : elapsedSec.value + 1;
      }, 1000);
    }
  } else if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
});
onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer);
});

const overlayStage = computed<{ title: string; subtitle: string }>(() => {
  const sec = elapsedSec.value;
  // Stages chosen by feel — a typical k8s pod restart is 10–25s.
  if (sec < 3) {
    return {
      title: 'Stopping current pod…',
      subtitle: 'Cancelling the running workflow.',
    };
  }
  if (sec < 10) {
    return {
      title: 'Deploying new pod…',
      subtitle: 'Scheduling on the cluster.',
    };
  }
  if (sec < 20) {
    return {
      title: 'Starting up…',
      subtitle: 'The container is pulling and initialising.',
    };
  }
  return {
    title: 'Almost ready…',
    subtitle: 'Waiting for the agent to come online.',
  };
});

const initials = computed(() => {
  const source = agent.value?.name?.trim() || agent.value?.id || '?';
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') || '?';
});
</script>

<template>
  <div class="flex h-[calc(100vh-3.5rem-1px)] flex-col">
    <!-- Compact header strip: back, agent identity, status, actions -->
    <header
      class="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3"
    >
      <NuxtLink
        to="/agents"
        class="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition"
        aria-label="Back to agents"
      >
        <Icon name="arrow-left" :size="16" />
      </NuxtLink>

      <div
        v-if="agent"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-primary/20 to-primary/5 text-sm font-semibold text-primary"
      >
        {{ initials }}
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h1 class="truncate text-sm font-semibold">
            <template v-if="agent">{{ agent.name }}</template>
            <template v-else-if="pending">Loading…</template>
            <template v-else>Agent not found</template>
          </h1>
          <span
            v-if="agent"
            class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span class="relative flex h-1.5 w-1.5">
              <span
                v-if="statusMeta.pulse"
                class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
                :class="statusMeta.dot"
              />
              <span
                class="relative inline-flex h-1.5 w-1.5 rounded-full"
                :class="statusMeta.dot"
              />
            </span>
            {{ statusMeta.label }}
          </span>
        </div>
        <p
          v-if="agent"
          class="mt-0.5 truncate text-xs text-muted-foreground"
          :title="agent.templateId"
        >
          {{ agent.templateId }}
        </p>
      </div>

      <button
        v-if="agent && canManage"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 transition"
        :disabled="isTransitioning"
        @click="onRestart"
      >
        <Icon
          :name="isTransitioning ? 'loader-2' : 'refresh-cw'"
          :size="13"
          :class="isTransitioning && 'animate-spin'"
        />
        {{ isTransitioning ? 'Restarting…' : 'Restart' }}
      </button>
    </header>

    <p
      v-if="restartError"
      class="shrink-0 border-b bg-rose-500/10 px-4 py-2 text-xs text-rose-700 dark:text-rose-400"
    >
      {{ restartError }}
    </p>

    <!-- Chat — expands to fill remaining height -->
    <div class="relative flex-1 min-h-0 overflow-hidden">
      <div v-if="pending && !agent" class="flex h-full items-center justify-center">
        <Icon name="loader-2" :size="20" class="animate-spin text-muted-foreground" />
      </div>
      <div
        v-else-if="error || !agent"
        class="flex h-full flex-col items-center justify-center gap-3 text-center px-4"
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon name="bot-off" :size="22" />
        </div>
        <div>
          <p class="text-sm font-medium">Agent unavailable</p>
          <p class="mt-1 text-xs text-muted-foreground">
            This agent may have been removed or the runtime is offline.
          </p>
        </div>
        <NuxtLink
          to="/agents"
          class="text-xs font-medium text-primary hover:underline"
        >
          ← Back to agents
        </NuxtLink>
      </div>
      <BridleChatProvider
        v-else
        :bot-id="agent.id"
        :title="agent.name"
        :subtitle="agent.templateId"
        :show-header="false"
      />

      <!-- Restart overlay — covers the chat while the pod is bouncing.
           Shown both during the API call and while the status is in a
           transitional state (deploying/pending). Slide in from below. -->
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-all duration-300 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="agent && isTransitioning"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm"
          aria-live="polite"
        >
          <div
            class="flex w-full max-w-sm flex-col items-center rounded-2xl border bg-card/95 px-6 py-7 text-center shadow-lg"
          >
            <!-- Concentric pulsing rings around the agent avatar -->
            <div class="relative mb-5 flex h-16 w-16 items-center justify-center">
              <span
                class="absolute inline-flex h-full w-full rounded-full bg-amber-500/20 animate-ping"
              />
              <span
                class="absolute inline-flex h-12 w-12 rounded-full bg-amber-500/30 animate-ping [animation-delay:200ms]"
              />
              <span
                class="relative flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-amber-500/30 to-amber-500/10 text-base font-semibold text-amber-700 dark:text-amber-400"
              >
                {{ initials }}
              </span>
            </div>

            <h3 class="text-sm font-semibold">{{ overlayStage.title }}</h3>
            <p class="mt-1.5 text-xs text-muted-foreground">
              {{ overlayStage.subtitle }}
            </p>

            <!-- Indeterminate progress bar — visual only, since k8s doesn't
                 give us percentage. -->
            <div class="mt-5 w-full overflow-hidden rounded-full bg-muted">
              <div class="h-1 w-1/3 rounded-full bg-amber-500 chat-restart-bar" />
            </div>

            <p class="mt-3 text-[11px] text-muted-foreground/70">
              Elapsed {{ elapsedSec }}s · agent will reload memory from S3
            </p>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
@keyframes chat-restart-bar {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
.chat-restart-bar {
  animation: chat-restart-bar 1.6s ease-in-out infinite;
}
</style>
