<script setup lang="ts">
import type { IndexStatus } from '#reins/stores/knowledge';
import { Badge as UiBadge } from '#theme/components/ui/badge';

// `processing` is not a fifth status, it is what the stored one cannot say.
// A run stops waiting long before LightRAG finishes a large document, so the
// row reads `ready` while a third of the content is still being chunked. The
// green "Ready" badge on a base that is only two thirds searchable is what
// sent people off believing an import had landed. Kept out of `IndexStatus`
// on purpose: that value also gates the Index button and the 3s poll, and a
// base waiting on the pipeline must stay indexable - new sources arrive while
// old ones are still cooking.
const props = defineProps<{ status: IndexStatus; processing?: boolean }>();

const stillWorking = computed(
  () => props.processing === true && props.status === 'ready',
);

const label = computed(() => {
  if (stillWorking.value) return 'Ready · still indexing';
  switch (props.status) {
    case 'idle':
      return 'Idle';
    case 'indexing':
      return 'Indexing…';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'empty':
      return 'Empty';
    case 'partial':
      return 'Partially indexed';
    default:
      return props.status;
  }
});

const variant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(
  () => {
    // Deliberately not the green `default`: searchable, but not all of it.
    if (stillWorking.value) return 'secondary';
    switch (props.status) {
      case 'ready':
        return 'default';
      case 'indexing':
      case 'partial':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  },
);

const title = computed(() =>
  stillWorking.value
    ? 'Some documents are still moving through LightRAG. They are confirmed automatically as it finishes.'
    : undefined,
);
</script>

<template>
  <UiBadge :variant="variant" :title="title">{{ label }}</UiBadge>
</template>
