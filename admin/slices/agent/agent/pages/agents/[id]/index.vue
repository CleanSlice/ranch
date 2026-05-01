<script setup lang="ts">
// Force a fresh component tree per agent. Without this Nuxt reuses the same
// page instance across `/agents/:id` switches — useAsyncData keys never
// re-fire, and local refs (logs, selected file, editor content) leak from
// the previously viewed agent. The dynamic key remounts the whole subtree
// (provider + file tree + bridle + logs) when the id changes.
definePageMeta({
  key: (route) => `agent-${route.params.id as string}`,
});

const route = useRoute();
const id = route.params.id as string;
</script>

<template>
  <AgentProvider :id="id" />
</template>
