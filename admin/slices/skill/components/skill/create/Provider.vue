<script setup lang="ts">
import type { ISkillInput } from '#skill/stores/skill';
import { IconArrowLeft } from '@tabler/icons-vue';

const skillStore = useSkillStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: ISkillInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await skillStore.create(values);
    await navigateTo('/skills');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/skills');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/skills"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to skills
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New skill</h1>
      <p class="text-sm text-muted-foreground">
        Markdown skill the agent picks up at start.
      </p>
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <SkillForm
      :submitting="submitting"
      submit-label="Create skill"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
