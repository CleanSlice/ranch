<script setup lang="ts">
// A CONSTANT page key, because Nuxt's default is the interpolated path
// (`/agents/<id>`) — with it, switching agents remounts this whole page,
// rail included: the rail loses its scroll position and flashes on every
// switch. Pinning the key keeps this instance alive across `/agents/:id`
// changes; the per-agent remount boundary is `<AgentWorkspaceMain :key="id">`,
// which still tears down logs, the file tree, the open section and the chat
// transcript when the agent changes.
definePageMeta({ key: 'agents-workspace' });

// Computed, not read once: this component instance is reused across
// `/agents/:id` changes, so a snapshot taken at setup would pin the
// workspace to whichever agent happened to be open first.
const route = useRoute();
const id = computed(() => route.params.id as string);
</script>

<template>
  <AgentItemProvider :id="id" />
</template>
