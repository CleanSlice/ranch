<script setup lang="ts">
definePageMeta({
  key: (route) => `agent-edit-${route.params.id as string}`,
});

const route = useRoute();
const id = route.params.id as string;
</script>

<template>
  <AgentEditProvider :id="id" />
</template>
