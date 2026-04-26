<script setup lang="ts">
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui';
import { Button } from '#theme/components/ui/button';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'destructive' | 'default';
    busy?: boolean;
  }>(),
  {
    title: 'Are you sure?',
    description: 'This action cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'destructive',
    busy: false,
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'confirm'): void;
}>();

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
});

function onCancel() {
  if (props.busy) return;
  emit('update:open', false);
}

function onConfirm() {
  if (props.busy) return;
  emit('confirm');
  emit('update:open', false);
}
</script>

<template>
  <AlertDialogRoot v-model:open="isOpen">
    <AlertDialogPortal>
      <AlertDialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <AlertDialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-2 text-center sm:text-left">
          <AlertDialogTitle class="text-foreground text-lg font-semibold">
            {{ title }}
          </AlertDialogTitle>
          <AlertDialogDescription class="text-muted-foreground text-sm">
            {{ description }}
          </AlertDialogDescription>
        </div>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" :disabled="busy" @click="onCancel">
            {{ cancelLabel }}
          </Button>
          <Button :variant="variant" :disabled="busy" @click="onConfirm">
            {{ confirmLabel }}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
