<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconPlayerPlay } from '@tabler/icons-vue';

const props = defineProps<{ agentId: string }>();
const emit = defineEmits<{ started: [evaluationId: string] }>();

const store = usePaddockEvaluationStore();

const open = ref(false);
const starting = ref(false);
const error = ref<string | null>(null);

async function onConfirm() {
  starting.value = true;
  error.value = null;
  try {
    const ev = await store.start({ agentId: props.agentId });
    emit('started', ev.id);
    open.value = false;
    navigateTo(`/paddock/${ev.id}`);
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : 'Failed to start evaluation.';
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div>
    <Button @click="open = true">
      <IconPlayerPlay class="size-4" />
      Run evaluation
    </Button>

    <ConfirmDialog
      v-model:open="open"
      title="Run paddock evaluation"
      :description="error
        ? error
        : 'Runs the merged set of template + agent scenarios with the configured judges. Only one evaluation can run per agent at a time.'"
      confirm-label="Start"
      cancel-label="Cancel"
      variant="default"
      :busy="starting"
      @confirm="onConfirm"
    />
  </div>
</template>
