<script setup lang="ts">
/**
 * The dashed target that takes the compose area's place while a file drag is
 * over the chat. Purely presentational — the drag events are owned by the
 * Provider, because the drop target is the whole conversation, not this block.
 * If this component listened for them itself, moving the pointer between it
 * and a sibling would read as leaving.
 */
defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="shrink-0 border-t bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-3">
      <!-- One row, sized to the compose box it replaces: a taller block would
           make the message list jump every time a file crosses the window. -->
      <div
        class="flex h-[3.25rem] items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 text-center transition"
        :class="
          disabled
            ? 'border-muted-foreground/25 bg-muted/30'
            : 'border-primary/50 bg-primary/5'
        "
      >
        <Icon
          :name="disabled ? 'ban' : 'upload'"
          :size="16"
          :class="disabled ? 'text-muted-foreground/60' : 'text-primary'"
        />
        <p
          class="truncate text-xs font-medium"
          :class="disabled ? 'text-muted-foreground' : 'text-primary'"
        >
          {{ disabled ? $t('chat.drop_disabled') : $t('chat.drop_hint') }}
        </p>
      </div>
    </div>
  </div>
</template>
