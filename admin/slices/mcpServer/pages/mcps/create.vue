<script setup lang="ts">
import type { ICreateMcpServerData } from '#mcpServer/stores/mcpServer';
import { IconArrowLeft } from '@tabler/icons-vue';

const mcpServerStore = useMcpServerStore();
const submitting = ref(false);
const submitError = ref<string | null>(null);

async function onSubmit(values: ICreateMcpServerData) {
  submitting.value = true;
  submitError.value = null;
  try {
    const created = await mcpServerStore.create(values);
    await navigateTo(`/mcps/${created.id}`);
  } catch (err) {
    submitError.value = (err as Error).message ?? 'Create failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/mcps');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/mcps" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to MCP servers
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">New MCP server</h1>
      <p class="text-sm text-muted-foreground">Register a tool server agents can connect to.</p>
    </div>

    <McpServerFormProvider
      :submitting="submitting"
      submit-label="Create MCP server"
      @submit="onSubmit"
      @cancel="onCancel"
    />

    <p v-if="submitError" class="text-xs text-destructive">{{ submitError }}</p>
  </div>
</template>
