<script setup lang="ts">
const route = useRoute();
const id = route.params.id as string;
</script>

<template>
  <AgentEditProvider :id="id" />
</template>
