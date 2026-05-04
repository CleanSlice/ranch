<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconRefresh, IconLoader2 } from '@tabler/icons-vue';

useHead({ title: 'Evaluations' });

const listRef = ref<{
  refresh: () => Promise<void>;
  pending: boolean;
} | null>(null);

const pending = computed(() => listRef.value?.pending ?? false);

async function onRefresh() {
  await listRef.value?.refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">Evaluations</h1>
        <p class="text-sm text-muted-foreground">
          Powered by Paddock — run scenarios against your agents and let LLM judges score the results.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        :disabled="pending"
        @click="onRefresh"
      >
        <IconLoader2 v-if="pending" class="size-4 animate-spin" />
        <IconRefresh v-else class="size-4" />
      </Button>
    </div>
    <PaddockEvaluationListProvider ref="listRef" />
  </div>
</template>
