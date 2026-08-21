<script setup lang="ts">
// Kept as the slice's entry point for a single agent so existing imports and
// the page component do not move. Everything it used to do — the header, the
// nine-tab column and every TabsContent — now lives in the workspace, where
// the tabs became a settings navigator and the sections render on the canvas
// (specs/006-agent-workspace-tabs).
defineProps<{ id: string }>();
</script>

<template>
  <AgentWorkspaceProvider :id="id" />
</template>
