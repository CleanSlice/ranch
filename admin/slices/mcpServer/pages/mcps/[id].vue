<script setup lang="ts">
import type { ICreateMcpServerData } from '#mcpServer/stores/mcpServer';
import { useBuiltFrom } from '#agent/composables/useBuiltFrom';

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

// A server the Ranch assistant is handed receives its calls, and the Ranch
// server its token: its address and credential are the Owner's (CLEAN-271).
// For anybody else the connection is shown, with one line and no Save.
const { locked, note } = useBuiltFrom(mcp);

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
    <PageBreadcrumbs :items="[{ label: 'MCP servers', to: '/mcps' }, { label: mcp?.name ?? '…' }]" />

    <div v-if="pending && !mcp" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="mcp">
      <div>
        <h1 class="text-2xl font-semibold">{{ mcp.name }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ locked ? 'MCP server connection.' : 'Edit MCP server connection.' }}
        </p>
      </div>

      <AccessNote v-if="locked" data-built-from>{{ note }}</AccessNote>

      <fieldset :disabled="locked" class="contents">
      <McpServerItemForm
        :read-only="locked"
        :initial-values="mcp"
        :submitting="submitting"
        submit-label="Save changes"
        @submit="onSubmit"
        @cancel="onCancel"
      />
      </fieldset>

      <p v-if="submitError" class="text-xs text-destructive">{{ submitError }}</p>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      MCP server not found.
    </div>
  </div>
</template>
