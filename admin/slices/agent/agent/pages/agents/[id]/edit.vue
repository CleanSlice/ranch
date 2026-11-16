<script setup lang="ts">
// The separate Edit page for an existing agent is retired (CLEAN-228, research
// R12): everything it changed is edited in place on the agent's Overview. The
// address is kept so old links and bookmarks land where the editing is now —
// replaced, not pushed, so Back does not bounce through here again.
definePageMeta({
  middleware: [
    (to) =>
      navigateTo(
        {
          path: `/agents/${encodeURIComponent(String(to.params.id))}`,
          query: { tab: 'overview' },
        },
        { replace: true },
      ),
  ],
});
</script>

<template>
  <div />
</template>
