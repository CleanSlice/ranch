<script setup lang="ts">
import type { ICreateAgentData, IUpdateAgentData } from '#agent/stores/agent';
import { IconArrowLeft } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const templateStore = useTemplateStore();
const llmStore = useLlmStore();

const [
  { data: agent, pending: pendingAgent },
  { data: templates, pending: pendingTemplates },
  { pending: pendingLlms },
] = await Promise.all([
  useAsyncData(`admin-agent-${props.id}-edit`, () =>
    agentStore.fetchById(props.id),
  ),
  useAsyncData('agent-edit-templates', () => templateStore.fetchAll()),
  useAsyncData('agent-edit-llms', () => llmStore.fetchAll()),
]);
const pending = computed(
  () => pendingAgent.value || pendingTemplates.value || pendingLlms.value,
);

const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: ICreateAgentData) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    const update: IUpdateAgentData = {
      name: values.name,
      llmCredentialId: values.llmCredentialId ?? null,
      resources: values.resources,
    };
    await agentStore.update(props.id, update);
    await navigateTo(`/agents/${props.id}`);
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo(`/agents/${props.id}`);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      :to="`/agents/${id}`"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to agent
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="agent">
      <div>
        <h1 class="text-2xl font-semibold">Edit agent</h1>
        <p class="text-sm text-muted-foreground">{{ agent.name }}</p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <AgentForm
        :templates="templates ?? []"
        :llms="llmStore.items"
        :initial-values="{
          name: agent.name,
          templateId: agent.templateId,
          llmCredentialId: agent.llmCredentialId,
          resources: agent.resources,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        disable-template
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Agent not found.
    </div>
  </div>
</template>
