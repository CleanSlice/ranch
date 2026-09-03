<script setup lang="ts">
import { Badge } from '#theme/components/ui/badge';
import type { SourceIndexStatus } from '#reins/stores/knowledge';

const props = defineProps<{ status: SourceIndexStatus }>();

const label = computed(() => {
  switch (props.status) {
    case 'indexed':
      return 'Indexed';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Pending';
    default:
      return props.status;
  }
});

const variant = computed<'default' | 'destructive' | 'outline'>(() => {
  switch (props.status) {
    case 'indexed':
      return 'default';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
});
</script>

<template>
  <Badge :variant="variant">{{ label }}</Badge>
</template>
