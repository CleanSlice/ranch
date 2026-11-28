<script setup lang="ts">
import type { ILlmCredentialInput } from '#llm/stores/llm';
import { useBuiltFrom } from '#agent/composables/useBuiltFrom';

const props = defineProps<{ id: string }>();

const llmStore = useLlmStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const { data: credential, pending } = await useAsyncData(
  `admin-llm-${props.id}-edit`,
  () => llmStore.fetchById(props.id),
);

// The credential the Ranch assistant runs on is the Owner's to change
// (CLEAN-271): its model, its key and whether it is active are what the
// assistant thinks with. For anybody else it is shown, with no Save.
const { locked, note } = useBuiltFrom(credential);

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
    <PageBreadcrumbs :items="[{ label: 'LLMs', to: '/llms' }, { label: credential ? `${credential.provider} · ${credential.model}` : '…' }]" />

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="credential">
      <div>
        <h1 class="text-2xl font-semibold">{{ locked ? 'Credential' : 'Edit credential' }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ credential.provider }} · {{ credential.model }}
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <AccessNote v-if="locked" data-built-from>{{ note }}</AccessNote>

      <fieldset :disabled="locked" class="contents">
      <LlmItemForm
        :read-only="locked"
        :initial-values="{
          provider: credential.provider,
          model: credential.model,
          fallbackModel: credential.fallbackModel ?? undefined,
          label: credential.label ?? undefined,
          apiKey: credential.apiKey,
          status: credential.status,
          supportsChat: credential.supportsChat,
          supportsEmbedding: credential.supportsEmbedding,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        @submit="onSubmit"
        @cancel="onCancel"
      />
      </fieldset>
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Credential not found.
    </div>
  </div>
</template>
