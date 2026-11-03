<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import type { ISkillInput } from '#skill/domain';
import { useSkillLayout } from '#skill/composables/useSkillLayout';

/**
 * Edit skill (CLEAN-205): the same form as New skill with "Save changes",
 * the slug editable (with the rename warning), no local draft — the saved
 * record is the source of truth — and the existing "Redeploy N agents"
 * prompt after a save, which then returns to the library with this skill
 * selected.
 */
const props = defineProps<{ id: string }>();

const skillStore = useSkillStore();
const confirmStore = useConfirmStore();
const { isPhone } = useSkillLayout();

// Loading state from the request, the record from the store (docs/state.md).
const { pending } = await useAsyncData(`admin-skill-${props.id}-edit`, () =>
  skillStore.fetchById(props.id),
);
const skill = computed(() => skillStore.byId(props.id));

interface FormHandle {
  submit: () => Promise<void>;
  valid: boolean;
  dirty: boolean;
}
const formRef = ref<FormHandle | null>(null);

const submitting = ref(false);
const serverError = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
let saved = false;
let savedName = '';

const modalOpen = ref(false);
const { agents, rows, redeploying, load, start } = useSkillRedeploy();

async function onSubmit(values: ISkillInput) {
  submitting.value = true;
  serverError.value = null;
  errorMessage.value = null;
  try {
    await skillStore.update(props.id, values);
    saved = true;
    savedName = values.name;
    await load(props.id);
    modalOpen.value = true;
  } catch (err: unknown) {
    const body = (err as { response?: { data?: { code?: string; message?: string } } }).response
      ?.data;
    if (body?.code === 'SKILL_EXISTS') serverError.value = 'This name is taken';
    else errorMessage.value = body?.message ?? (err as Error).message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function backToSkills() {
  const name = savedName || skill.value?.name;
  void navigateTo({ path: '/skills', query: name ? { skill: name } : {} });
}

const leaveAsk = {
  title: 'Discard unsaved changes?',
  description: 'Your edits to this skill are not saved yet.',
  confirmLabel: 'Discard changes',
  cancelLabel: 'Stay',
  variant: 'destructive' as const,
};
onBeforeRouteLeave(async () => {
  if (saved || !formRef.value?.dirty) return true;
  return confirmStore.ask(leaveAsk);
});
useEventListener(
  () => (typeof window === 'undefined' ? null : window),
  'beforeunload',
  (e: BeforeUnloadEvent) => {
    if (saved || !formRef.value?.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  },
);
</script>

<template>
  <div class="flex flex-col gap-6" :class="isPhone && 'pb-24'">
    <PageBreadcrumbs :items="[{ label: 'Skills', to: '/skills' }, { label: skill?.title ?? '…' }]" />

    <Skeleton v-if="pending && !skill" class="h-96" />

    <template v-else-if="skill">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold">Edit skill</h1>
          <p class="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            <code>{{ skill.name }}</code> · {{ skill.title }}
          </p>
        </div>
        <div v-if="!isPhone" class="flex gap-2">
          <Button variant="ghost" data-action="cancel" @click="backToSkills">Cancel</Button>
          <Button data-action="submit" :disabled="submitting || !formRef?.valid" @click="formRef?.submit()">
            {{ submitting ? 'Saving…' : 'Save changes' }}
          </Button>
        </div>
      </div>

      <p v-if="errorMessage" role="alert" class="text-xs text-destructive">{{ errorMessage }}</p>

      <SkillItemForm
        ref="formRef"
        :key="skill.id"
        mode="edit"
        :initial-values="{
          title: skill.title,
          name: skill.name,
          group: skill.group,
          description: skill.description ?? '',
          body: skill.body,
        }"
        :skill-id="skill.id"
        :original-name="skill.name"
        :templates="skill.templates"
        :submitting="submitting"
        :server-error="serverError"
        @submit="onSubmit"
      />

      <SkillEditFilesCard
        v-if="skill.files?.length"
        :files="skill.files"
        :source="skill.source ?? null"
      />

      <div
        v-if="isPhone"
        class="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <Button variant="outline" class="min-h-11 flex-1" data-action="cancel" @click="backToSkills">Cancel</Button>
        <Button class="min-h-11 flex-1" data-action="submit" :disabled="submitting || !formRef?.valid" @click="formRef?.submit()">
          {{ submitting ? 'Saving…' : 'Save changes' }}
        </Button>
      </div>
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
      @close="backToSkills"
    />
  </div>
</template>
