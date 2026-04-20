<script setup lang="ts">
import type { ICreateAgentData } from '#agent/stores/agent';
import { IconArrowLeft } from '@tabler/icons-vue';

const agentStore = useAgentStore();
const templateStore = useTemplateStore();

const { data: templates, pending } = await useAsyncData(
  'agent-create-templates',
  () => templateStore.fetchAll(),
);

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

    <AgentForm
      v-else
      :templates="templates ?? []"
      :submitting="submitting"
      submit-label="Create agent"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
