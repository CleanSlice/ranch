<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';
import { IconTrash, IconEdit } from '@tabler/icons-vue';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

const props = defineProps<{
  templateId?: string;
  agentId?: string;
}>();

const emit = defineEmits<{
  edit: [scenario: IPaddockScenario];
  create: [];
}>();

const store = usePaddockScenarioStore();

const { data: scenarios, pending, refresh } = await useAsyncData(
  `paddock-scenarios-${props.templateId ?? 'all'}-${props.agentId ?? 'all'}`,
  () => store.fetchAll({ templateId: props.templateId, agentId: props.agentId }),
);

const removeError = ref<string | null>(null);

async function onRemove(scenario: IPaddockScenario) {
  removeError.value = null;
  try {
    await store.remove(scenario.id);
    await refresh();
  } catch (err: unknown) {
    removeError.value =
      err instanceof Error ? err.message : 'Failed to delete scenario.';
  }
}

defineExpose({ refresh });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">Scenarios</h2>
        <p class="text-sm text-muted-foreground">
          Test cases used when evaluating agents on this {{ templateId ? 'template' : 'agent' }}.
        </p>
      </div>
      <Button size="sm" @click="emit('create')">New scenario</Button>
    </div>

    <div
      v-if="removeError"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ removeError }}
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="scenarios?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Difficulty</TableHead>
            <TableHead>Messages</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="s in scenarios" :key="s.id">
            <TableCell class="max-w-sm">
              <div class="font-medium">{{ s.name }}</div>
              <div class="text-xs text-muted-foreground line-clamp-2">{{ s.description }}</div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{{ s.category }}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{{ s.difficulty }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ s.messages.length }}</TableCell>
            <TableCell>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="ghost" @click="emit('edit', s)">
                  <IconEdit class="size-4" />
                </Button>
                <Button size="sm" variant="ghost" @click="onRemove(s)">
                  <IconTrash class="size-4 text-destructive" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No scenarios yet. Add the first one to start evaluating.
    </div>
  </div>
</template>
