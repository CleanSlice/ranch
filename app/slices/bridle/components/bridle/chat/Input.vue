<script setup lang="ts">
import {
  FILE_PICKER_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '#bridle/domain';

const props = defineProps<{ disabled?: boolean; agentId: string }>();
const emit = defineEmits<{ send: [text: string] }>();

const bridleStore = useBridleStore();

const draft = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const staged = computed(() => bridleStore.stagedFor(props.agentId));
const attachmentError = computed(() =>
  bridleStore.attachmentErrorFor(props.agentId),
);

const atLimit = computed(
  () => staged.value.length >= MAX_ATTACHMENTS_PER_MESSAGE,
);
const canAttach = computed(() => !props.disabled && !atLimit.value);
const canSend = computed(() => bridleStore.canSend(props.agentId, draft.value));

/** Why the attach control is off, so the tooltip says something useful. */
const attachTitle = computed(() => {
  if (atLimit.value) {
    return { key: 'chat.attach_limit', count: MAX_ATTACHMENTS_PER_MESSAGE };
  }
  return { key: 'chat.attach', count: 0 };
});

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  // Cap at ~6 rows (~144px) so very long drafts get an internal scrollbar
  // instead of pushing the message list off-screen.
  el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
}

function submit() {
  if (!canSend.value) return;
  emit('send', draft.value.trim());
  draft.value = '';
  nextTick(() => autoResize());
}

function openPicker() {
  if (!canAttach.value) return;
  fileInputRef.value?.click();
}

function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) bridleStore.stageFiles(props.agentId, input.files);
  // Reset so picking the same file twice in a row still fires `change`.
  input.value = '';
}

/**
 * Pasting a screenshot should behave like any other attachment. Only files are
 * intercepted — pasting text stays plain text, which is what people expect.
 */
function onPaste(event: ClipboardEvent) {
  if (!canAttach.value) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  bridleStore.stageFiles(props.agentId, files);
}

watch(draft, () => nextTick(autoResize));
</script>

<template>
  <form
    class="shrink-0 border-t bg-background"
    @submit.prevent="submit"
  >
    <div class="mx-auto w-full max-w-3xl px-4 py-3">
      <div
        class="group flex flex-col gap-2 rounded-2xl border bg-background px-2 py-1.5 shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
        :class="disabled && 'opacity-60'"
      >
        <!-- Staged files sit inside the compose box so it reads as one block -->
        <div
          v-if="staged.length"
          class="flex flex-wrap gap-1.5 px-1 pt-1"
        >
          <BridleChatAttachmentChip
            v-for="attachment in staged"
            :key="attachment.localId"
            :attachment="attachment"
            @remove="bridleStore.removeStaged(agentId, $event)"
            @retry="bridleStore.retryStaged(agentId, $event)"
          />
        </div>

        <div class="flex items-end gap-1">
          <button
            type="button"
            :disabled="!canAttach"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            :aria-label="$t('chat.attach')"
            :title="$t(attachTitle.key, { count: attachTitle.count })"
            @click="openPicker"
          >
            <Icon
              name="paperclip"
              :size="16"
            />
          </button>

          <input
            ref="fileInputRef"
            type="file"
            multiple
            class="hidden"
            :accept="FILE_PICKER_ACCEPT"
            @change="onFilesPicked"
          >

          <textarea
            ref="textareaRef"
            v-model="draft"
            :placeholder="$t('chat.placeholder')"
            rows="1"
            class="flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed"
            :disabled="disabled"
            @keydown.enter.exact.prevent="submit"
            @paste="onPaste"
          />

          <button
            type="submit"
            :disabled="!canSend"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            :aria-label="$t('chat.send')"
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
      </div>

      <!-- Rejections are announced, not just coloured: a screen reader user
           gets no signal from a red chip. -->
      <p
        v-if="attachmentError"
        class="mt-1.5 flex items-start gap-1.5 px-1 text-[11px] text-destructive"
        role="status"
        aria-live="polite"
      >
        <Icon
          name="alert-circle"
          :size="12"
          class="mt-px shrink-0"
        />
        <span>{{ $t(attachmentError.key, attachmentError.params ?? {}) }}</span>
        <button
          type="button"
          class="ml-1 underline underline-offset-2 hover:opacity-80"
          @click="bridleStore.dismissAttachmentError(agentId)"
        >
          {{ $t('chat.dismiss') }}
        </button>
      </p>

      <!-- i18n-t keeps the sentence one translatable string with the two key
           caps as slots — translators reorder words, and splitting this into
           fragments around the <kbd> tags would make that impossible. -->
      <i18n-t
        v-else
        keypath="chat.input_hint"
        tag="p"
        class="mt-1.5 px-1 text-[11px] text-muted-foreground/60"
      >
        <template #enter>
          <kbd class="rounded border bg-muted px-1 font-mono text-[10px]">Enter</kbd>
        </template>
        <template #shiftEnter>
          <kbd class="rounded border bg-muted px-1 font-mono text-[10px]">Shift+Enter</kbd>
        </template>
      </i18n-t>
    </div>
  </form>
</template>
