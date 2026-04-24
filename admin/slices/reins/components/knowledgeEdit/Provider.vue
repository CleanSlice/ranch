<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';
import type { IKnowledgeFormValues } from '#reins/components/knowledge/Form.vue';

const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: IKnowledgeFormValues) {
  if (!current?.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await store.update(current.value.id, {
      name: values.name,
      description: values.description ?? null,
    });
    if (refresh) await refresh();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Update failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/knowledges');
}
</script>

<template>
  <div v-if="current" class="max-w-2xl">
    <p v-if="errorMessage" class="mb-3 text-xs text-destructive">{{ errorMessage }}</p>
    <KnowledgeForm
      :initial-values="{
        name: current.name,
        description: current.description ?? undefined,
      }"
      :submitting="submitting"
      submit-label="Save"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
