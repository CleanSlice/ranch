<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { toast } from 'vue-sonner';
import { useRelativeTime } from '#common/composables/useRelativeTime';
import type { ISkillInput } from '#skill/domain';
import { useSkillDraft, type SkillDraftValues } from '#skill/composables/useSkillDraft';
import { useSkillLayout } from '#skill/composables/useSkillLayout';

/**
 * New skill (CLEAN-205): the form plus what the page owns — the draft in
 * localStorage, the header / bottom-bar actions, the leave guard and the
 * redirect to the library with the new skill selected.
 */
const skillStore = useSkillStore();
const confirmStore = useConfirmStore();
const { isPhone } = useSkillLayout();

interface FormHandle {
  submit: () => Promise<void>;
  valid: boolean;
  dirty: boolean;
}
const formRef = ref<FormHandle | null>(null);

const slug = ref('');
const draft = useSkillDraft(slug);
const savedAgo = useRelativeTime(() => draft.savedAt.value);
// The shared clock can lag the save by a few seconds, which the relative text
// would phrase as "in 3 seconds"; a draft written this minute is "just now".
const savedLabel = computed(() => (savedAgo.value.startsWith('in ') ? 'just now' : savedAgo.value));

// The draft lives in the browser and is keyed by the signed-in user, so the
// form mounts on the client once the auth store knows who that is (a fresh
// page load fills it a moment after mount) and the draft has been read.
const auth = useAuthStore();
const ready = ref(false);
const initial = ref<Partial<SkillDraftValues>>({});
onMounted(() => {
  const stop = watch(
    () => auth.user?.id ?? null,
    (id) => {
      if (!id || ready.value) return;
      const restored = draft.read();
      if (restored) {
        initial.value = restored;
        slug.value = restored.name;
      }
      ready.value = true;
      void nextTick(() => stop());
    },
    { immediate: true },
  );
});

function onChange(values: SkillDraftValues) {
  slug.value = values.name;
  void draft.save(values);
}

const submitting = ref(false);
const serverError = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
let created = false;

async function onSubmit(values: ISkillInput) {
  submitting.value = true;
  serverError.value = null;
  errorMessage.value = null;
  try {
    await skillStore.create(values);
    created = true;
    draft.clear();
    toast.success(`Skill ${values.name} created`);
    await navigateTo({ path: '/skills', query: { skill: values.name } });
  } catch (err: unknown) {
    const body = (err as { response?: { data?: { code?: string; message?: string } } }).response
      ?.data;
    if (body?.code === 'SKILL_EXISTS') serverError.value = 'This name is taken';
    else errorMessage.value = body?.message ?? (err as Error).message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  void navigateTo('/skills');
}

const leaveAsk = {
  title: 'Leave without creating the skill?',
  description: 'What you typed stays as a draft in this browser.',
  confirmLabel: 'Leave',
  cancelLabel: 'Stay',
};
onBeforeRouteLeave(async () => {
  if (created || !formRef.value?.dirty) return true;
  return confirmStore.ask(leaveAsk);
});
useEventListener(
  () => (typeof window === 'undefined' ? null : window),
  'beforeunload',
  (e: BeforeUnloadEvent) => {
    if (created || !formRef.value?.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  },
);
</script>

<template>
  <div class="flex flex-col gap-6" :class="isPhone && 'pb-24'">
    <PageBreadcrumbs :items="[{ label: 'Skills', to: '/skills' }, { label: 'New skill' }]" />

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">New skill</h1>
        <p v-if="draft.savedAt.value" data-skill-draft class="text-sm text-muted-foreground">
          Draft · edited {{ savedLabel }}
        </p>
        <p v-else class="text-sm text-muted-foreground">Markdown skill the agent picks up at start.</p>
      </div>
      <div v-if="!isPhone" class="flex gap-2">
        <Button variant="ghost" data-action="cancel" @click="onCancel">Cancel</Button>
        <Button data-action="submit" :disabled="submitting || !formRef?.valid" @click="formRef?.submit()">
          {{ submitting ? 'Creating…' : 'Create skill' }}
        </Button>
      </div>
    </div>

    <p v-if="errorMessage" role="alert" class="text-xs text-destructive">{{ errorMessage }}</p>

    <SkillItemForm
      v-if="ready"
      ref="formRef"
      mode="create"
      :initial-values="initial"
      :submitting="submitting"
      :server-error="serverError"
      @submit="onSubmit"
      @change="onChange"
    />
    <Skeleton v-else class="h-96" />

    <div
      v-if="isPhone"
      class="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <Button variant="outline" class="min-h-11 flex-1" data-action="cancel" @click="onCancel">Cancel</Button>
      <Button class="min-h-11 flex-1" data-action="submit" :disabled="submitting || !formRef?.valid" @click="formRef?.submit()">
        {{ submitting ? 'Creating…' : 'Create skill' }}
      </Button>
    </div>
  </div>
</template>
