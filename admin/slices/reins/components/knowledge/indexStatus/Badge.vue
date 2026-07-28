<script setup lang="ts">
import { Badge } from '#theme/components/ui/badge';
import type { IndexStatus } from '#reins/stores/knowledge';

const props = defineProps<{ status: IndexStatus }>();

const label = computed(() => {
  switch (props.status) {
    case 'idle':
      return 'Idle';
    case 'indexing':
      return 'Indexing…';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return props.status;
  }
});

const variant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(
  () => {
    switch (props.status) {
      case 'ready':
        return 'default';
      case 'indexing':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  },
);
</script>

<template>
  <Badge :variant="variant">{{ label }}</Badge>
</template>
