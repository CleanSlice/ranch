<script setup lang="ts">
/**
 * The dashed target that takes the compose area's place while a file drag is
 * over the chat. Purely presentational — the drag events are owned by the
 * Provider, because the drop target is the whole conversation, not this block.
 * If this component listened for them itself, moving the pointer between it
 * and a sibling would read as leaving.
 */
import { MAX_ATTACHMENTS_PER_MESSAGE } from '#bridle/domain';

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="border-t bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-3">
      <!-- Height roughly matches the compose area it replaces, so swapping
           the two doesn't make the message list jump. -->
      <div
        class="flex min-h-[3.25rem] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-4 text-center transition"
        :class="
          disabled
            ? 'border-muted-foreground/25 bg-muted/30'
            : 'border-primary/50 bg-primary/5'
        "
      >
        <Icon
          :name="disabled ? 'ban' : 'upload'"
          :size="18"
          :class="disabled ? 'text-muted-foreground/60' : 'text-primary'"
        />
        <p
          class="text-xs font-medium"
          :class="disabled ? 'text-muted-foreground' : 'text-primary'"
        >
          {{ disabled ? $t('chat.drop_disabled') : $t('chat.drop_hint') }}
        </p>
      </div>
      <p class="mt-1.5 px-1 text-[11px] text-muted-foreground/60">
        {{ $t('chat.attach_limit', { count: MAX_ATTACHMENTS_PER_MESSAGE }) }}
      </p>
    </div>
  </div>
</template>
