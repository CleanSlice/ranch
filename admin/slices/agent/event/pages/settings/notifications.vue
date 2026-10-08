<script setup lang="ts">
/**
 * Settings → Notifications. The page file lives in the event slice — the
 * destination belongs to events — and the settings layout picks it up as a
 * child route; `setting` only lists it in its menu.
 */
const store = useAgentEventStore();
const auth = useAuthStore();

// The API keeps the destination for the owner (@Roles(Owner)); an admin may
// read. The page says so instead of offering a button that would be refused.
const canEdit = computed(() => auth.user?.role === 'Owner');

const { pending, error } = useAsyncData(
  'admin-settings-notifications',
  async () => {
    await store.fetchDestination();
    return true;
  },
  { server: false },
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <p v-if="pending && !store.destination" class="text-sm text-muted-foreground">
      Loading…
    </p>
    <div
      v-else-if="error && !store.destination"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ error.message }}
    </div>
    <template v-else>
      <AgentEventDestinationForm :can-edit="canEdit" />
      <AgentEventDestinationTestButton :can-edit="canEdit" />
    </template>
    <AgentEventDestinationSenderGuide />
  </div>
</template>
