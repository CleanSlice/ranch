<script setup lang="ts">
import type { IKnowledgeFormValues } from '#reins/components/knowledge/Form.vue';

const store = useKnowledgeStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: IKnowledgeFormValues) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    const created = await store.create({
      name: values.name,
      description: values.description,
    });
    if (created) {
      await navigateTo(`/knowledges/${created.id}/edit`);
    } else {
      await navigateTo('/knowledges');
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Create failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/knowledges');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/knowledges"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      ← Back to Knowledge
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New knowledge</h1>
      <p class="text-sm text-muted-foreground">
        Create a knowledge base. Sources and graph config come next.
      </p>
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <KnowledgeForm
      :submitting="submitting"
      submit-label="Create"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
