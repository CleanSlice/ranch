<script setup lang="ts">
const chatStore = useChatStore();

// The request gives `pending` and `refresh`; the list itself is the store's
// collection (docs/state.md), which `listMine` replaces.
const { pending, refresh } = await useAsyncData('my-chats', () =>
  // A value, because a handler that resolves to nothing is reported as a
  // failed fetch; what it loaded is in the store.
  chatStore.listMine().then(() => true),
);
const { sessions, showArchived } = storeToRefs(chatStore);

// Current conversations, or the ones a "New chat" closed (CLEAN-136). The
// two are separate lists on the server, so this is a switch, not a filter
// over what is already loaded.
const switching = ref(false);
async function onShow(archived: boolean) {
  if (switching.value || showArchived.value === archived) return;
  switching.value = true;
  try {
    await chatStore.setShowArchived(archived);
  } finally {
    switching.value = false;
  }
}

// Copy decided in script travels as a key (docs/i18n.md).
const emptyTitleKey = computed(() =>
  showArchived.value ? 'history.empty_earlier_title' : 'history.empty_title',
);
const emptyHintKey = computed(() =>
  showArchived.value ? 'history.empty_earlier_hint' : 'history.empty_hint',
);

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
        <h1 class="text-2xl font-bold tracking-tight">{{ $t('history.title') }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ $t('history.lede') }}
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
          :class="syncing ? 'animate-spin' : undefined"
        />
        {{ $t(syncing ? 'history.syncing' : 'history.sync') }}
      </button>
    </header>

    <!-- Current conversations, or the ones closed by starting a new chat. -->
    <div
      class="inline-flex self-start rounded-md border p-0.5 text-sm"
      role="group"
      :aria-label="$t('history.title')"
    >
      <button
        type="button"
        class="rounded px-3 py-1 font-medium transition"
        :class="
          showArchived
            ? 'text-muted-foreground hover:text-foreground'
            : 'bg-muted text-foreground'
        "
        :aria-pressed="!showArchived"
        @click="onShow(false)"
      >
        {{ $t('history.filter_current') }}
      </button>
      <button
        type="button"
        class="rounded px-3 py-1 font-medium transition"
        :class="
          showArchived
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        "
        :aria-pressed="showArchived"
        @click="onShow(true)"
      >
        {{ $t('history.filter_earlier') }}
      </button>
    </div>

    <!-- Loading skeletons (initial load, and while the other list loads) -->
    <div
      v-if="(pending || switching) && !sessions.length"
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
      <h2 class="mt-4 text-base font-semibold">{{ $t(emptyTitleKey) }}</h2>
      <p class="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        {{ $t(emptyHintKey) }}
      </p>
      <!-- "Browse agents" answers "no conversations yet"; under Earlier
           there is nothing to go and do. -->
      <NuxtLink
        v-if="!showArchived"
        to="/agents"
        class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-95 transition"
      >
        <Icon name="bot" :size="14" />
        {{ $t('history.empty_cta') }}
      </NuxtLink>
    </div>
  </div>
</template>
