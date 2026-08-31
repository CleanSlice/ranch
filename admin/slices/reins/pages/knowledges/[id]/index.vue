<script setup lang="ts">
// The sectionless URL /knowledges/:id used to render an empty body — the
// layout has tabs but no default child. Land on the everyday section, with
// the Sources tab correctly marked current (FR-027, SC-010).
const route = useRoute();

await navigateTo(`/knowledges/${route.params.id as string}/sources`, {
  replace: true,
});
</script>

<template>
  <div />
</template>
