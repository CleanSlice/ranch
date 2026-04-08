<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Templates</h1>
    <div v-if="pending">Loading templates...</div>
    <div v-else-if="templates?.length" class="grid gap-4 md:grid-cols-2">
      <div
        v-for="tmpl in templates"
        :key="tmpl.id"
        class="p-4 border rounded-lg"
      >
        <h3 class="font-medium">{{ tmpl.name }}</h3>
        <p class="text-sm text-muted-foreground">{{ tmpl.description }}</p>
        <p class="text-xs mt-2">{{ tmpl.image }}</p>
      </div>
    </div>
    <div v-else class="text-muted-foreground">No templates available.</div>
  </div>
</template>

<script setup lang="ts">
const templateStore = useTemplateStore();

const { data: templates, pending } = await useAsyncData(
  'templates',
  () => templateStore.fetchAll(),
);
</script>
