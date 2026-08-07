<script setup lang="ts">
// Thin wrapper: the Overview tab renders the same shared usage panel as the
// chat tab's side stack and the Rancher page, so the surfaces cannot drift.
defineProps<{ agentId: string }>();
</script>

<template>
  <UsagePanel :agent-id="agentId" agent-only />
</template>
