<script setup lang="ts">
// The card grid is gone (FR-019). This route is a resolver: it picks the
// agent to open and hands over to `/agents/:id`, which is the address that
// can be linked, shared and reached with the back button. It only renders
// when there is nothing to open.
const agentStore = useAgentStore();
const authStore = useAuthStore();
const { resolveLanding } = useLastAgent();

const canCreate = computed(() =>
  authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin),
);

// Awaited for its loading state; the list itself is read from the store like
// everywhere else (docs/state.md).
const { pending } = await useAsyncData('agents', () => agentStore.fetchAll());
const { agents } = storeToRefs(agentStore);

// Remembered agent → first running → first in the list. The remembered id is
// only honoured while it is still in this user's visible list, so a deleted
// or newly-hidden agent is a non-event rather than a dead landing.
const landing = computed(() => resolveLanding(agents.value));

watchEffect(() => {
  if (landing.value) {
    void navigateTo(`/agents/${landing.value.id}`, { replace: true });
  }
});
</script>

<template>
  <div v-if="pending && !agents.length" class="flex flex-col gap-4">
    <div class="h-8 w-48 animate-pulse rounded bg-muted" />
    <div class="h-64 w-full animate-pulse rounded-xl bg-muted/70" />
  </div>

  <!-- A person who reaches no agents (CLEAN-231): nothing here is theirs to
       create, and "spin up your first" would send them looking for a button
       they do not have. Owner and Admin keep the state below. Only when the
       list really came back empty: a list that could not be read leaves an
       error in the store and is not "no access". -->
  <div
    v-else-if="!landing && !canCreate && !agentStore.error"
    class="rounded-xl border border-dashed bg-card/40 p-8 text-center sm:p-12"
    data-agents-empty="no_access"
  >
    <div
      class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <Icon name="bot" :size="22" />
    </div>
    <h2 class="mt-4 text-base font-semibold">{{ $t('agents.no_access_title') }}</h2>
    <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
      {{ $t('agents.no_access_body') }}
    </p>
  </div>

  <div
    v-else-if="!landing"
    class="rounded-xl border border-dashed bg-card/40 p-12 text-center"
  >
    <div
      class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <Icon name="bot" :size="22" />
    </div>
    <h2 class="mt-4 text-base font-semibold">{{ $t('list.empty_title') }}</h2>
    <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
      {{ $t('list.empty_hint') }}
    </p>
    <NuxtLink
      v-if="canCreate"
      to="/agents/create"
      class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-95"
    >
      <Icon name="plus" :size="14" />
      {{ $t('list.empty_cta') }}
    </NuxtLink>
    <p v-else class="mt-5 text-xs text-muted-foreground/70">
      {{ $t('list.empty_no_permission') }}
    </p>
  </div>
</template>
