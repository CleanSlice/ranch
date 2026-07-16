<script setup lang="ts">
const chatStore = useChatStore();

const { data: result, pending, refresh } = await useAsyncData('my-chats', () =>
  chatStore.listMine(),
);

const sessions = computed(() => result.value?.items ?? []);

// Manual reconcile fallback for when realtime indexing hasn't caught up yet.
const syncing = ref(false);
async function onSync() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await chatStore.syncMine();
    await refresh();
  } finally {
    syncing.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">History</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Your past conversations. Open one to pick up where you left off.
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
        :disabled="syncing"
        @click="onSync"
      >
        <Icon
          name="refresh-cw"
          :size="14"
          :class="syncing && 'animate-spin'"
        />
        {{ syncing ? 'Syncing…' : 'Sync' }}
      </button>
    </header>

    <!-- Loading skeletons (initial load only) -->
    <div
      v-if="pending && !sessions.length"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="flex flex-col rounded-xl border bg-card p-5"
      >
        <div class="flex items-start gap-3">
          <div class="h-10 w-10 shrink-0 rounded-lg bg-muted animate-pulse" />
          <div class="flex-1 space-y-2">
            <div class="h-4 w-32 rounded bg-muted animate-pulse" />
            <div class="h-3 w-44 rounded bg-muted/70 animate-pulse" />
          </div>
        </div>
        <div class="mt-4 h-3 w-24 rounded bg-muted/70 animate-pulse" />
      </div>
    </div>

    <div
      v-else-if="sessions.length"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <ChatListCard
        v-for="session in sessions"
        :key="session.id"
        :session="session"
      />
    </div>

    <div
      v-else
      class="rounded-xl border border-dashed bg-card/40 p-12 text-center"
    >
      <div
        class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon name="message-square" :size="22" />
      </div>
      <h2 class="mt-4 text-base font-semibold">No conversations yet</h2>
      <p class="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        Chat with an agent and it'll show up here so you can revisit it later.
      </p>
      <NuxtLink
        to="/agents"
        class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-95 transition"
      >
        <Icon name="bot" :size="14" />
        Browse agents
      </NuxtLink>
    </div>
  </div>
</template>
