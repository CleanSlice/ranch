<script setup lang="ts">
// Computed, not read once: this component instance is reused across
// `/agents/:id` changes, so a snapshot taken at setup would pin the workspace
// to whichever agent happened to be open first.
const route = useRoute();
const id = computed(() => route.params.id as string);
</script>

<template>
  <AgentWorkspaceProvider :id="id" />
</template>
