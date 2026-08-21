<script setup lang="ts">
const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const authStore = useAuthStore();
const { remember } = useLastAgent();

const canCreate = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

// One list request for the whole workspace, shared with the resolver page by
// its key so landing here does not re-fetch what it already read.
const { data: agents, pending, refresh } = await useAsyncData('agents', () =>
  agentStore.fetchAll(),
);

// The rail shows every agent's runtime state, so it has to keep up with
// agents other people start and stop. The app console has no status stream
// of its own (admin's SSE feed is public, but porting the client is a
// separate piece of work — see research R3), so this polls at the same
// cadence the cards screen already polled capacity at. The open agent keeps
// its own 3s poll while it is transitioning.
let listTimer: ReturnType<typeof setInterval> | null = null;
let capacityTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  listTimer = setInterval(() => void refresh(), 30_000);
  if (!canCreate.value) return;
  void agentStore.fetchCapacity();
  capacityTimer = setInterval(() => void agentStore.fetchCapacity(), 30_000);
});
onUnmounted(() => {
  if (listTimer) clearInterval(listTimer);
  if (capacityTimer) clearInterval(capacityTimer);
});

const capacity = computed(() => agentStore.capacity);

// Remember whichever agent is open so the next visit lands back on it.
watch(
  () => props.id,
  (id) => {
    if (id) remember(id);
  },
  { immediate: true },
);

const railOverlayOpen = ref(false);

function onSelect(id: string) {
  railOverlayOpen.value = false;
  if (id === props.id) return;
  void navigateTo(`/agents/${id}`);
}
</script>

<template>
  <!-- 3.5rem + 1px = the app header and its border. The layout already treats
       this route as flush (no container, no footer), so the workspace owns
       the remaining height. -->
  <div class="flex h-[calc(100vh-3.5rem-1px)] min-h-0">
    <aside class="hidden w-68 shrink-0 border-r p-3 md:block">
      <AgentWorkspaceRail
        :agents="agents"
        :active-id="id"
        :pending="pending"
        :can-create="canCreate"
        :capacity="capacity"
        @select="onSelect"
      />
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Narrow screens: the rail is one tap away rather than a column. -->
      <div class="shrink-0 border-b px-3 py-2 md:hidden">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
          @click="railOverlayOpen = true"
        >
          <Icon name="list" :size="13" />
          {{ $t('rail.switch') }}
        </button>
      </div>

      <div class="min-h-0 flex-1">
        <AgentChatProvider :id="id" />
      </div>
    </div>

    <div
      v-if="railOverlayOpen"
      class="fixed inset-0 z-40 flex flex-col gap-2 bg-background p-3 md:hidden"
    >
      <div class="flex shrink-0 items-center justify-between">
        <span class="text-sm font-medium">{{ $t('nav.agents') }}</span>
        <button
          type="button"
          class="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          :aria-label="$t('rail.close')"
          @click="railOverlayOpen = false"
        >
          <Icon name="x" :size="16" />
        </button>
      </div>

      <div class="min-h-0 flex-1">
        <AgentWorkspaceRail
          :agents="agents"
          :active-id="id"
          :pending="pending"
          :can-create="canCreate"
          :capacity="capacity"
          @select="onSelect"
        />
      </div>
    </div>
  </div>
</template>
