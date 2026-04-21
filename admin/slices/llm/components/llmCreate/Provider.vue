<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
import { IconArrowLeft } from '@tabler/icons-vue';

const llmStore = useLlmStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: ILlmCredentialInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await llmStore.create(values);
    await navigateTo('/llms');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/llms');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/llms"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to LLMs
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New credential</h1>
      <p class="text-sm text-muted-foreground">
        Add an LLM provider/model pair with its API key.
      </p>
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <LlmForm
      :submitting="submitting"
      submit-label="Create credential"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
