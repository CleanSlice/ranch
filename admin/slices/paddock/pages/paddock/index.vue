<script setup lang="ts">
useHead({ title: 'Evaluations' });
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">Evaluations</h1>
      <p class="text-sm text-muted-foreground">
        Powered by Paddock — run scenarios against your agents and let LLM judges score the results.
      </p>
    </div>
    <PaddockEvaluationListProvider />
  </div>
</template>
