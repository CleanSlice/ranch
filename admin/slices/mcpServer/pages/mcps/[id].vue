<script setup lang="ts">
import type { ICreateMcpServerData } from '#mcpServer/stores/mcpServer';
import { IconArrowLeft } from '@tabler/icons-vue';

definePageMeta({
  key: (route) => `mcp-${route.params.id as string}`,
});

const route = useRoute();
const id = route.params.id as string;

const mcpServerStore = useMcpServerStore();

const { data: mcp, pending } = useAsyncData(
  `admin-mcp-${id}`,
  () => mcpServerStore.fetchById(id),
  { lazy: true },
);

const submitting = ref(false);
const submitError = ref<string | null>(null);

async function onSubmit(values: ICreateMcpServerData) {
  submitting.value = true;
  submitError.value = null;
  try {
    await mcpServerStore.update(id, values);
    await navigateTo('/mcps');
  } catch (err) {
    submitError.value = (err as Error).message ?? 'Update failed';
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

    <div v-if="pending && !mcp" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="mcp">
      <div>
        <h1 class="text-2xl font-semibold">{{ mcp.name }}</h1>
        <p class="text-sm text-muted-foreground">Edit MCP server connection.</p>
      </div>

      <McpServerFormProvider
        :initial-values="mcp"
        :submitting="submitting"
        submit-label="Save changes"
        @submit="onSubmit"
        @cancel="onCancel"
      />

      <p v-if="submitError" class="text-xs text-destructive">{{ submitError }}</p>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      MCP server not found.
    </div>
  </div>
</template>
