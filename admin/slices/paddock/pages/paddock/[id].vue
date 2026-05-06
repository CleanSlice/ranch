<script setup lang="ts">
const route = useRoute();
const id = computed(() => route.params.id as string);
useHead({ title: () => `Evaluation ${id.value}` });
</script>

<template>
  <!-- :key forces a full remount when the route param changes (e.g. after
       Rerun navigates to a new evaluation id). Without it, Provider's
       async setup keeps the previous evaluation in `evaluation.value`
       until the next poll overwrites it, briefly showing the old run's
       progress on the new page. -->
  <PaddockEvaluationProvider :key="id" :evaluation-id="id" />
</template>
