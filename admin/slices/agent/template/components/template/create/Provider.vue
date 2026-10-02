<script setup lang="ts">
import type { ICreateTemplateData } from '#template/stores/template';

const templateStore = useTemplateStore();
const knowledgeStore = useKnowledgeStore();
const submitting = ref(false);

const [{ data: knowledges }] = await Promise.all([
  useAsyncData('template-create-knowledges', () => knowledgeStore.fetchAll()),
  useAsyncData('template-create-knowledge-status', () =>
    knowledgeStore.fetchStatus(),
  ),
]);

async function onSubmit(values: ICreateTemplateData): Promise<void> {
  submitting.value = true;
  const created = await templateStore.create(values);
  submitting.value = false;
  await navigateTo(`/templates/${created.id}`);
}

function onCancel(): void {
  navigateTo('/templates');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageBreadcrumbs :items="[{ label: 'Templates', to: '/templates' }, { label: 'New template' }]" />

    <div>
      <h1 class="text-2xl font-semibold">New template</h1>
      <p class="text-sm text-muted-foreground">Define a blueprint for spawning agents.</p>
    </div>

    <TemplateItemForm
      :knowledges="knowledges ?? []"
      :knowledge-service-enabled="knowledgeStore.enabled"
      :submitting="submitting"
      submit-label="Create template"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
