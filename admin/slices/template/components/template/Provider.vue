<template>
  <div v-if="pending">Loading...</div>
  <div v-else-if="template">
    <slot :template="template" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ templateId: string }>();
const templateStore = useTemplateStore();

const { data: template, pending } = await useAsyncData(
  `admin-template-${props.templateId}`,
  () => templateStore.fetchById(props.templateId),
);
</script>
