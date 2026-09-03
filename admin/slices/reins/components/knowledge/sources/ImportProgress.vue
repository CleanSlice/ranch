<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import type { IImportJob } from '#reins/stores/knowledge';

const props = defineProps<{ jobs: IImportJob[] }>();

// Finished jobs the user has closed. Ids only; the list itself keeps coming
// from the API so a job that is still running can never be dismissed.
const dismissed = ref<Set<string>>(new Set());

const visible = computed(() =>
  props.jobs.filter((j) => j.status === 'running' || !dismissed.value.has(j.id)),
);

const expanded = ref<Set<string>>(new Set());

function processed(job: IImportJob): number {
  return job.added + job.skipped + job.failed;
}

function percent(job: IImportJob): number {
  if (job.detected === 0) return 100;
  return Math.min(100, Math.round((processed(job) / job.detected) * 100));
}

function dismiss(id: string) {
  dismissed.value = new Set([...dismissed.value, id]);
}

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
</script>

<template>
  <div v-if="visible.length" class="flex flex-col gap-2">
    <div
      v-for="job in visible"
      :key="job.id"
      class="rounded-md border bg-card p-3 text-sm"
      :class="job.status === 'failed' ? 'border-destructive/50' : ''"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <span v-if="job.status === 'running'">Importing archive:</span>
          <span v-else-if="job.status === 'done'">Archive imported:</span>
          <span v-else class="text-destructive">Archive import failed:</span>
          <span class="ml-1 font-medium">{{ job.added }} / {{ job.detected }} added</span>
          <span class="text-muted-foreground"> · {{ job.skipped }} skipped</span>
          <span :class="job.failed ? 'text-destructive' : 'text-muted-foreground'">
            · {{ job.failed }} failed
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            v-if="job.errors.length"
            size="sm"
            variant="ghost"
            @click="toggle(job.id)"
          >
            {{ expanded.has(job.id) ? 'Hide errors' : `Show errors (${job.errors.length})` }}
          </Button>
          <Button
            v-if="job.status !== 'running'"
            size="sm"
            variant="ghost"
            @click="dismiss(job.id)"
          >
            Dismiss
          </Button>
        </div>
      </div>

      <div class="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
        <div
          class="h-full transition-all"
          :class="job.status === 'failed' ? 'bg-destructive' : 'bg-primary'"
          :style="{ width: `${percent(job)}%` }"
        />
      </div>

      <ul
        v-if="expanded.has(job.id)"
        class="mt-2 max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-muted-foreground"
      >
        <li v-for="(line, i) in job.errors" :key="i" class="break-words">
          {{ line }}
        </li>
        <li v-if="job.failed > job.errors.length" class="italic">
          … and {{ job.failed - job.errors.length }} more
        </li>
      </ul>
    </div>
  </div>
</template>
