<script setup lang="ts">
import type { ICreateTemplateData } from '#template/stores/template';
import { IconArrowLeft } from '@tabler/icons-vue';

const templateStore = useTemplateStore();
const submitting = ref(false);

async function onSubmit(values: ICreateTemplateData) {
  submitting.value = true;
  const created = await templateStore.create(values);
  submitting.value = false;
  await navigateTo(`/templates/${created.id}`);
}

function onCancel() {
  navigateTo('/templates');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/templates"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to templates
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New template</h1>
      <p class="text-sm text-muted-foreground">Define a blueprint for spawning agents.</p>
    </div>

    <TemplateForm
      :submitting="submitting"
      submit-label="Create template"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
