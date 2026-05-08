<script setup lang="ts">
const route = useRoute();
const id = route.params.id as string;

await navigateTo({ path: `/agents/${id}`, query: { tab: 'paddock' } }, { replace: true });
</script>

<template>
  <div />
</template>
