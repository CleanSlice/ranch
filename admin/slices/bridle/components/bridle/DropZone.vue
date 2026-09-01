<script setup lang="ts">
/**
 * The dashed target that takes the composer's place while a file drag is over
 * the chat. Purely presentational — the drag events belong to the Provider,
 * because the drop target is the whole conversation, not this block. If this
 * component listened for them itself, moving the pointer between it and a
 * sibling would read as leaving.
 */
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../../utils/attachment'
import { Ban, Upload } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'

defineProps<{ disabled?: boolean }>()
</script>

<template>
  <div class="w-full">
    <!-- Height roughly matches the composer it replaces, so the swap doesn't
         make the message list jump. -->
    <div
      :class="cn(
        'flex min-h-[40px] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-4 text-center',
        disabled
          ? 'border-muted-foreground/25 bg-muted/30'
          : 'border-primary/50 bg-primary/5',
      )"
    >
      <component
        :is="disabled ? Ban : Upload"
        :class="cn('h-4 w-4', disabled ? 'text-muted-foreground/60' : 'text-primary')"
      />
      <p
        :class="cn(
          'text-xs font-medium',
          disabled ? 'text-muted-foreground' : 'text-primary',
        )"
      >
        {{ disabled ? 'Wait for the agent to finish replying' : 'Drop files here to attach them' }}
      </p>
    </div>
    <p class="mt-1.5 text-[11px] text-muted-foreground/60">
      You can attach up to {{ MAX_ATTACHMENTS_PER_MESSAGE }} files
    </p>
  </div>
</template>
