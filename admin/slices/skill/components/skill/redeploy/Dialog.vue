<script setup lang="ts">
import type { ISkillDependentAgent } from '#skill/stores/skill';
import type { ISkillRedeployRow } from '#skill/composables/useSkillRedeploy';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { IconLoader2, IconCheck, IconX } from '@tabler/icons-vue';

const props = defineProps<{
  open: boolean;
  agents: ISkillDependentAgent[];
  rows: ISkillRedeployRow[];
  redeploying: boolean;
  title?: string;
  // Shown as <code> in the initial description; falls back to "this skill".
  skillName?: string | null;
  closeLabel?: string;
}>();

const emit = defineEmits<{ close: []; start: [] }>();

const progress = computed(() => {
  const total = props.rows.length;
  const settled = props.rows.filter(
    (r) => r.status === 'done' || r.status === 'failed',
  ).length;
  return { total, settled };
});

function onOpenUpdate(open: boolean) {
  // Block dismissing mid-redeploy — otherwise the loop keeps running headless
  // and the operator loses the progress view.
  if (!open && !props.redeploying) emit('close');
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenUpdate">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-foreground text-lg font-semibold">
            {{ title ?? 'Redeploy agents using this skill?' }}
          </DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            <template v-if="agents.length === 0">
              No agents currently use this skill — nothing to redeploy.
            </template>
            <template v-else-if="rows.length === 0">
              {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}
              use<span v-if="agents.length === 1">s</span>
              <code v-if="skillName">{{ skillName }}</code>
              <template v-else>this skill</template>
              via templates. They keep running the previous version until
              restarted.
            </template>
            <template v-else-if="redeploying">
              Redeploying {{ progress.settled }} / {{ progress.total }}…
            </template>
            <template v-else>
              Redeploy finished — {{ progress.settled }} / {{ progress.total }} processed.
            </template>
          </DialogDescription>
        </div>

        <ul
          v-if="rows.length > 0"
          class="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3"
        >
          <li
            v-for="row in rows"
            :key="row.agent.id"
            class="flex items-center gap-2 py-1 text-sm"
          >
            <IconLoader2
              v-if="row.status === 'running'"
              class="size-4 shrink-0 animate-spin text-primary"
            />
            <IconCheck
              v-else-if="row.status === 'done'"
              class="size-4 shrink-0 text-emerald-600"
            />
            <IconX
              v-else-if="row.status === 'failed'"
              class="size-4 shrink-0 text-destructive"
            />
            <span
              v-else
              class="inline-block size-4 shrink-0 rounded-full border border-muted-foreground/30"
            />
            <span class="truncate font-medium">{{ row.agent.name }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">
              ({{ row.agent.templateName }})
            </span>
            <span
              v-if="row.error"
              class="ml-auto truncate text-xs text-destructive"
            >
              {{ row.error }}
            </span>
          </li>
        </ul>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button v-if="!redeploying" variant="outline" @click="emit('close')">
            {{ closeLabel ?? (rows.length === 0 ? 'Skip' : 'Close') }}
          </Button>
          <Button
            v-if="agents.length > 0 && rows.length === 0"
            @click="emit('start')"
          >
            Redeploy {{ agents.length }} agent{{ agents.length === 1 ? '' : 's' }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
