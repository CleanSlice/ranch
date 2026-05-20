<script setup lang="ts">
import type { ISessionData } from '#sessions/stores/session';
import SessionInstallPanel from './InstallPanel.vue';
import SessionList from './List.vue';

const store = useSessionStore();

const {
  data: items,
  pending,
  refresh,
} = await useAsyncData('admin-sessions-list', () => store.fetchAll());

// Light polling so a session shows up shortly after the extension pushes
// cookies, without the user reloading the page.
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null);
onMounted(() => {
  pollHandle.value = setInterval(() => refresh(), 8000);
});
onUnmounted(() => {
  if (pollHandle.value) clearInterval(pollHandle.value);
});

const pendingRemoval = ref<ISessionData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await store.disconnect(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div>
      <h1 class="text-2xl font-semibold">Sessions</h1>
      <p class="text-sm text-muted-foreground">
        Browser sessions your agents reuse to act on your behalf. You log in
        on a site in your own Chrome, then ship the cookies to Ranch with the
        Ranch Cookies extension — no passwords are ever stored here.
      </p>
    </div>

    <SessionInstallPanel />

    <section class="flex flex-col gap-3">
      <h2 class="text-lg font-medium">Your sessions</h2>
      <p v-if="pending" class="text-sm text-muted-foreground">Loading…</p>
      <SessionList
        v-else
        :items="items ?? []"
        @remove="(item) => (pendingRemoval = item)"
      />
    </section>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Remove session"
      :description="
        pendingRemoval
          ? `Remove the ${pendingRemoval.service} session (“${pendingRemoval.accountKey}”)? The stored cookies are wiped — agents lose access until you send cookies again.`
          : ''
      "
      confirm-label="Remove"
      @confirm="onRemove"
    />
  </div>
</template>
