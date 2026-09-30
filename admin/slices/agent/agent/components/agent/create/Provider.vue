<script setup lang="ts">
import type { ICreateAgentData } from '#agent/stores/agent';
import { IconArrowLeft } from '@tabler/icons-vue';

const agentStore = useAgentStore();
const templateStore = useTemplateStore();
const llmStore = useLlmStore();
const knowledgeStore = useKnowledgeStore();

const [
  { data: templates, pending: pendingTemplates },
  { pending: pendingLlms },
  { data: knowledges, pending: pendingKnowledges },
  { pending: pendingKnowledgeStatus },
] = await Promise.all([
  useAsyncData('agent-create-templates', () => templateStore.fetchAll()),
  useAsyncData('agent-create-llms', () => llmStore.fetchAll()),
  useAsyncData('agent-create-knowledges', () => knowledgeStore.fetchAll()),
  useAsyncData('agent-create-knowledge-status', () =>
    knowledgeStore.fetchStatus(),
  ),
]);
const pending = computed(
  () =>
    pendingTemplates.value ||
    pendingLlms.value ||
    pendingKnowledges.value ||
    pendingKnowledgeStatus.value,
);

// "Spawn agent" on a template page lands here with `?templateId=` (CLEAN-130):
// that template is preselected and its resource defaults fill the form, the
// same as picking it in the select would.
const route = useRoute();
const initialValues = computed<ICreateAgentData | undefined>(() => {
  const id = route.query.templateId;
  const preset = typeof id === 'string' ? templates.value?.find((t) => t.id === id) : undefined;
  if (!preset) return undefined;
  return {
    name: '',
    templateId: preset.id,
    resources: { ...preset.defaultResources },
  };
});

const submitting = ref(false);

async function onSubmit(values: ICreateAgentData) {
  submitting.value = true;
  const created = await agentStore.create(values);
  submitting.value = false;
  await navigateTo(`/agents/${created.id}`);
}

function onCancel() {
  navigateTo('/agents');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/agents"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to agents
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New agent</h1>
      <p class="text-sm text-muted-foreground">Spawn a new runtime instance.</p>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <AgentItemForm
      v-else
      :templates="templates ?? []"
      :llms="llmStore.items"
      :knowledges="knowledges ?? []"
      :knowledge-service-enabled="knowledgeStore.enabled"
      :initial-values="initialValues"
      :submitting="submitting"
      submit-label="Create agent"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>

