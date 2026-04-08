<template>
  <div v-if="pending">Loading template...</div>
  <div v-else-if="template">
    <h2 class="text-xl font-bold">{{ template.name }}</h2>
    <p class="text-muted-foreground">{{ template.description }}</p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ templateId: string }>();
const templateStore = useTemplateStore();

const { data: template, pending } = await useAsyncData(
  `template-${props.templateId}`,
  () => templateStore.fetchById(props.templateId),
);
</script>
