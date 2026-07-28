<script setup lang="ts">
import type { ISkillInput } from '#skill/stores/skill';
import { IconArrowLeft } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const skillStore = useSkillStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const { data: skill, pending } = await useAsyncData(
  `admin-skill-${props.id}-edit`,
  () => skillStore.fetchById(props.id),
);

const modalOpen = ref(false);
const { agents, rows, redeploying, load, start } = useSkillRedeploy();

async function onSubmit(values: ISkillInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await skillStore.update(props.id, values);
    await load(props.id);
    modalOpen.value = true;
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

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="skill">
      <div>
        <h1 class="text-2xl font-semibold">Edit skill</h1>
        <p class="text-sm text-muted-foreground">
          <code>{{ skill.name }}</code> · {{ skill.title }}
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <SkillItemForm
        :initial-values="{
          name: skill.name,
          title: skill.title,
          body: skill.body,
          description: skill.description ?? undefined,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        lock-name
        @submit="onSubmit"
        @cancel="onCancel"
      />

      <SkillEditFilesCard
        v-if="skill.files?.length"
        :files="skill.files"
        :source="skill.source ?? null"
      />
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Skill not found.
    </div>

    <SkillRedeployDialog
      :open="modalOpen"
      :agents="agents"
      :rows="rows"
      :redeploying="redeploying"
      title="Saved"
      close-label="Back to skills"
      @start="start"
      @close="navigateTo('/skills')"
    />
  </div>
</template>
