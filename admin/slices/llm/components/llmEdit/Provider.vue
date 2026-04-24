<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
import { IconArrowLeft } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const llmStore = useLlmStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const { data: credential, pending } = await useAsyncData(
  `admin-llm-${props.id}-edit`,
  () => llmStore.fetchById(props.id),
);

async function onSubmit(values: ILlmCredentialInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await llmStore.update(props.id, values);
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

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="credential">
      <div>
        <h1 class="text-2xl font-semibold">Edit credential</h1>
        <p class="text-sm text-muted-foreground">
          {{ credential.provider }} · {{ credential.model }}
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <LlmForm
        :initial-values="{
          provider: credential.provider,
          model: credential.model,
          fallbackModel: credential.fallbackModel ?? undefined,
          label: credential.label ?? undefined,
          apiKey: credential.apiKey,
          status: credential.status,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Credential not found.
    </div>
  </div>
</template>
