<script setup lang="ts">
// The visitor entry point: `/share?token=sl_…`. Unguarded — `auth.global.ts`
// only protects `/agents/**` and `/chats/**`, so a browser with no console
// session lands straight here (FR-008).
definePageMeta({ layout: 'blank' });

// Computed, not read once: Nuxt reuses this component when only the query
// changes, so a snapshot taken at setup would pin the page to the first token.
const route = useRoute();
const token = computed(() => String(route.query.token ?? ''));
</script>

<template>
  <SharePageProvider :token="token" />
</template>
