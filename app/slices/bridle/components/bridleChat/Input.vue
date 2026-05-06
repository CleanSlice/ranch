<script setup lang="ts">
const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const { t } = useI18n();

const draft = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(() => draft.value.trim().length > 0 && !props.disabled);

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  // Cap at ~6 rows (~144px) so very long drafts get an internal scrollbar
  // instead of pushing the message list off-screen.
  el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
}

function submit() {
  const text = draft.value.trim();
  if (!text || props.disabled) return;
  emit('send', text);
  draft.value = '';
  nextTick(() => autoResize());
}

watch(draft, () => nextTick(autoResize));
</script>

<template>
  <form
    class="border-t bg-background"
    @submit.prevent="submit"
  >
    <div class="mx-auto w-full max-w-3xl px-4 py-3">
      <div
        class="group flex items-end gap-2 rounded-2xl border bg-background pl-4 pr-2 py-1.5 shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
        :class="disabled && 'opacity-60'"
      >
        <textarea
          ref="textareaRef"
          v-model="draft"
          :placeholder="t('chat.placeholder')"
          rows="1"
          class="flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed"
          :disabled="disabled"
          @keydown.enter.exact.prevent="submit"
        />
        <button
          type="submit"
          :disabled="!canSend"
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
          :aria-label="t('chat.send')"
        >
          <Icon
            v-if="disabled"
            name="loader-2"
            :size="16"
            class="animate-spin"
          />
          <Icon
            v-else
            name="send"
            :size="16"
          />
        </button>
      </div>
      <p class="mt-1.5 px-1 text-[11px] text-muted-foreground/60">
        <kbd class="rounded border bg-muted px-1 font-mono text-[10px]">Enter</kbd>
        to send,
        <kbd class="rounded border bg-muted px-1 font-mono text-[10px]">Shift+Enter</kbd>
        for newline
      </p>
    </div>
  </form>
</template>
