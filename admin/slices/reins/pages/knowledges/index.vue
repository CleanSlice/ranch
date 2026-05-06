<script setup lang="ts">
const store = useKnowledgeStore();
await useAsyncData('knowledges-status', () => store.fetchStatus());

const allReady = computed(
  () =>
    store.enabled &&
    store.setup.hasChatCredential &&
    store.setup.hasEmbeddingCredential &&
    store.setup.hasUrl &&
    store.setup.hasBucket &&
    store.setup.hasCredentialsSelected &&
    store.setup.isHealthy,
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <KnowledgeSetupWizard
      v-if="!allReady"
      :setup="store.setup"
      :enabled="store.enabled"
    />
    <KnowledgeListProvider v-else />
  </div>
</template>
