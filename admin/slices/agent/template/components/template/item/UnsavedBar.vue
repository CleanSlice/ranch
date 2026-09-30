<script setup lang="ts">
/**
 * The sticky "Unsaved changes" bar under the Skills and MCP tabs (CLEAN-130).
 * Toggling a card only edits a draft; this is where the draft is written or
 * thrown away, with the size of the change in view before the click.
 */
defineProps<{
  added: number;
  removed: number;
  saving: boolean;
  error: string | null;
}>();

defineEmits<{ discard: []; save: [] }>();
</script>

<template>
  <div class="sticky bottom-5 z-10 flex flex-col items-center gap-2 self-center">
    <p v-if="error" class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
      {{ error }}
    </p>
    <div
      class="flex items-center gap-3.5 rounded-xl bg-foreground py-2 pl-4 pr-2 text-[13.5px] text-background shadow-[0_20px_40px_-12px_rgba(0,0,0,.35)]"
      role="status"
    >
      <span>Unsaved changes</span>
      <span class="font-mono text-xs text-emerald-300">+{{ added }}</span>
      <span class="-ml-2 font-mono text-xs text-rose-300">−{{ removed }}</span>
      <button
        type="button"
        class="h-8 rounded-[7px] px-3 text-[13px] text-background/70 transition-colors hover:bg-background/15 hover:text-background disabled:opacity-50"
        :disabled="saving"
        @click="$emit('discard')"
      >
        Discard
      </button>
      <button
        type="button"
        class="h-8 rounded-[7px] bg-background px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-background/85 disabled:opacity-50"
        :disabled="saving"
        @click="$emit('save')"
      >
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </div>
  </div>
</template>
