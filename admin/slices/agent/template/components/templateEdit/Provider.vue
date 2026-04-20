<script setup lang="ts">
import type { ICreateTemplateData } from '#template/stores/template';
import { IconArrowLeft } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const templateStore = useTemplateStore();
const submitting = ref(false);

const { data: template, pending } = await useAsyncData(
  `admin-template-${props.id}-edit`,
  () => templateStore.fetchById(props.id),
);

async function onSubmit(values: ICreateTemplateData) {
  submitting.value = true;
  await templateStore.update(props.id, values);
  submitting.value = false;
  await navigateTo(`/templates/${props.id}`);
}

function onCancel() {
  navigateTo(`/templates/${props.id}`);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      :to="`/templates/${id}`"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to template
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="template">
      <div>
        <h1 class="text-2xl font-semibold">Edit template</h1>
        <p class="text-sm text-muted-foreground">{{ template.name }}</p>
      </div>

      <TemplateForm
        :initial-values="{
          name: template.name,
          description: template.description,
          image: template.image,
          defaultConfig: template.defaultConfig,
          defaultResources: template.defaultResources,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      Template not found.
    </div>
  </div>
</template>
