<script setup lang="ts">
import { useRelativeTime } from '#common/composables/useRelativeTime';
import { formatDateTime } from '#common/utils/format';
import { ACTIVITY_LABEL, type ActivityEntry } from '#skill/utils/activity';

const props = defineProps<{ entry: ActivityEntry }>();

const relative = useRelativeTime(() => props.entry.at);
</script>

<template>
  <li class="flex items-baseline justify-between gap-3 text-sm">
    <span>{{ ACTIVITY_LABEL[entry.kind] }}</span>
    <time :datetime="entry.at" :title="formatDateTime(entry.at)" class="shrink-0 text-xs text-muted-foreground">
      {{ relative }} · {{ formatDateTime(entry.at) }}
    </time>
  </li>
</template>
