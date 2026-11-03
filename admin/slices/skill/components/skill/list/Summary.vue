<script setup lang="ts">
import { useRelativeTime } from '#common/composables/useRelativeTime';
import type { LibrarySummary } from '#skill/utils/summary';
import { formatTokens } from '#skill/utils/formatTokens';

const props = defineProps<{ summary: LibrarySummary }>();

const lastEdit = useRelativeTime(() => props.summary.latestEdit);
</script>

<template>
  <dl
    class="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4"
    data-skill-summary
    :data-count="summary.count"
    :data-tokens="summary.totalTokens"
    :data-edited-week="summary.editedThisWeek"
    :data-unused="summary.unused.length"
  >
    <div>
      <dt class="text-xs text-muted-foreground">Skills</dt>
      <dd class="text-2xl font-semibold tabular-nums">{{ summary.count }}</dd>
    </div>
    <div>
      <dt class="text-xs text-muted-foreground">Total size</dt>
      <dd class="text-2xl font-semibold tabular-nums">≈ {{ formatTokens(summary.totalTokens) }}</dd>
      <dd class="text-xs text-muted-foreground">tokens</dd>
    </div>
    <div>
      <dt class="text-xs text-muted-foreground">Edited this week</dt>
      <dd class="text-2xl font-semibold tabular-nums">{{ summary.editedThisWeek }}</dd>
      <dd v-if="summary.latestEdit" class="text-xs text-muted-foreground">last {{ lastEdit }}</dd>
    </div>
    <div class="min-w-0">
      <dt class="text-xs text-muted-foreground">Not used in templates</dt>
      <dd class="text-2xl font-semibold tabular-nums">{{ summary.unused.length }}</dd>
      <dd
        v-if="summary.unused.length"
        class="truncate font-mono text-xs text-muted-foreground"
        :title="summary.unused.join(', ')"
      >
        {{ summary.unused.join(', ') }}
      </dd>
    </div>
  </dl>
</template>
