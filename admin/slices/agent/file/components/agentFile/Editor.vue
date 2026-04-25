<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconDeviceFloppy } from '@tabler/icons-vue';

const props = defineProps<{
  value: string;
  saving: boolean;
  error: string | null;
  readOnly?: boolean;
  dirty: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:value', v: string): void;
  (e: 'save'): void;
}>();

function onInput(e: Event) {
  emit('update:value', (e.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2">
    <textarea
      :value="value"
      :readonly="readOnly"
      spellcheck="false"
      class="min-h-[280px] flex-1 resize-none rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
      @input="onInput"
    />
    <div class="flex items-center justify-between gap-2">
      <p
        v-if="error"
        class="truncate text-xs text-destructive"
        :title="error"
      >
        {{ error }}
      </p>
      <p v-else-if="readOnly" class="text-xs text-muted-foreground">
        Read only — only .md and .json files can be edited
      </p>
      <p v-else-if="dirty" class="text-xs text-muted-foreground">Unsaved changes</p>
      <p v-else class="text-xs text-muted-foreground">Saved</p>

      <Button
        size="sm"
        :disabled="readOnly || !dirty || saving"
        @click="emit('save')"
      >
        <IconDeviceFloppy class="size-4" :class="saving && 'animate-pulse'" />
        Save
      </Button>
    </div>
  </div>
</template>
