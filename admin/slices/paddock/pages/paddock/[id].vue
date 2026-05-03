<script setup lang="ts">
const route = useRoute();
const id = computed(() => route.params.id as string);
useHead({ title: () => `Evaluation ${id.value}` });
</script>

<template>
  <PaddockEvaluationProvider :evaluation-id="id" />
</template>
