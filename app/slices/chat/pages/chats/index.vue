<script setup lang="ts">
// There is no History page any more (CLEAN-248): a person's conversations
// are inside the agent they were with. An old link or bookmark lands on the
// agents.
await navigateTo('/agents', { replace: true });
</script>

<template>
  <div />
</template>
