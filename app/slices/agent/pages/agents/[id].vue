<script setup lang="ts">
// One key for every `/agents/:id`. Without it Nuxt keys the page by the
// resolved path, so picking another agent threw the whole workspace away and
// mounted it again: the orbit map replayed its entrance and the search was
// lost (CLEAN-229). The parts that belong to one agent, the sheet and the
// chat, are keyed by id inside the workspace.
definePageMeta({ key: 'agent-workspace' });

// Computed, not read once: this component instance is reused across
// `/agents/:id` changes, so a snapshot taken at setup would pin the workspace
// to whichever agent happened to be open first.
const route = useRoute();
const id = computed(() => route.params.id as string);
</script>

<template>
  <AgentWorkspaceProvider :id="id" />
</template>
