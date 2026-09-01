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
  <!-- One row, the same 40px the composer occupies: the card has a fixed
       height, so a taller block here would push the footer and come out
       clipped. -->
  <div
    :class="cn(
      'flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 text-xs',
      disabled
        ? 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
        : 'border-primary/50 bg-primary/5 text-primary',
    )"
  >
    <component :is="disabled ? Ban : Upload" class="h-4 w-4 shrink-0" />
    <span class="truncate font-medium">
      {{
        disabled
          ? 'Wait for the agent to finish replying'
          : `Drop files here to attach them — up to ${MAX_ATTACHMENTS_PER_MESSAGE}`
      }}
    </span>
  </div>
</template>
