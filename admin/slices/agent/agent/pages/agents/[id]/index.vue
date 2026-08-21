<script setup lang="ts">
// No `definePageMeta({ key })` here on purpose. The per-agent remount
// boundary moved one level down, onto `<AgentWorkspaceMain :key="id">`: it
// still guarantees that logs, the file tree, the open section and the chat
// transcript are torn down when the agent changes, but it leaves the agent
// rail alone. Keyed at the page level, the rail would remount on every
// switch — refetching the agent list and flashing the whole column.
// Computed, not read once: without a page key this component instance is
// reused across `/agents/:id` changes, so a snapshot taken at setup would
// pin the workspace to whichever agent happened to be open first.
const route = useRoute();
const id = computed(() => route.params.id as string);
</script>

<template>
  <AgentItemProvider :id="id" />
</template>
