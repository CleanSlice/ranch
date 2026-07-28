<script setup lang="ts">
import type { ISkillExistsConflict } from '#skill/stores/skill';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { IconExternalLink, IconLoader2 } from '@tabler/icons-vue';

const props = defineProps<{
  open: boolean;
  existing: ISkillExistsConflict['existing'] | null;
  overwriting: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

function onOpenUpdate(open: boolean) {
  if (!open && !props.overwriting) emit('cancel');
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenUpdate">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-foreground text-lg font-semibold">
            Skill already exists
          </DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            A skill with the slug
            <code v-if="existing">{{ existing.name }}</code>
            is already installed. Overwriting will fully replace its content,
            files and source.
          </DialogDescription>
        </div>

        <div
          v-if="existing"
          class="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm"
        >
          <div>
            <div class="font-medium">{{ existing.title }}</div>
            <div class="text-xs text-muted-foreground">
              <code>{{ existing.name }}</code>
            </div>
          </div>
          <p v-if="existing.description" class="text-xs text-muted-foreground">
            {{ existing.description }}
          </p>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Updated {{ formatDateTime(existing.updatedAt) }}</span>
            <a
              v-if="existing.source"
              :href="existing.source"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1 underline"
            >
              current source <IconExternalLink class="size-3" />
            </a>
          </div>
        </div>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" :disabled="overwriting" @click="emit('cancel')">
            Cancel
          </Button>
          <Button variant="destructive" :disabled="overwriting" @click="emit('confirm')">
            <IconLoader2 v-if="overwriting" class="size-4 animate-spin" />
            {{ overwriting ? 'Overwriting…' : 'Overwrite' }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
