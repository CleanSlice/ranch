<script setup lang="ts">
import type { IBridleConversation } from '#bridle/domain';
import { newChatHintKey } from '#bridle/utils/newChat';

/**
 * "New chat" for one conversation (CLEAN-136): the header button and the
 * confirmation behind it. Placed by whoever draws the chat's header — the
 * share page, the console's agent page — and given the conversation
 * descriptor, nothing else.
 *
 * It holds no state about the conversation. Whether the action is available,
 * and why not, comes from the bridle store by key; confirming hands the
 * conversation to `startNewChat`, which either empties it for real or leaves
 * it as it is and puts a notice in the chat's own error strip.
 *
 * `app` has no dialog primitive, so the confirmation is hand-rolled in the
 * idiom of the share panel: an absolutely positioned card anchored to the
 * header strip (which carries `relative`), closed by Escape, an outside click
 * or Cancel.
 */
const props = defineProps<{ conversation: IBridleConversation }>();

const bridleStore = useBridleStore();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const hintId = useId();

/** Why the action is unavailable right now, or null when it is not. */
const block = computed(() => bridleStore.newChatBlock(props.conversation.key));
const busy = computed(() => block.value === 'busy');

// Copy decided in script travels as a key, never as text (docs/i18n.md).
const hintKey = computed(() => newChatHintKey(block.value));
// A visitor cannot get the conversation back; a console user finds it in
// their history. The sentence has to say which.
const confirmKey = computed(() =>
  props.conversation.share
    ? 'chat.new_chat_confirm_share'
    : 'chat.new_chat_confirm_console',
);

// --------------------------------------------------------------- open / close

function onDocumentMousedown(event: MouseEvent) {
  // The trigger lives inside `root`, so its own click never closes here.
  if (root.value?.contains(event.target as Node)) return;
  close();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close();
    return;
  }
  // Two buttons, so the trap is one swap: Tab from either goes to the other.
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const onCancel = document.activeElement === cancelButton.value;
  (onCancel ? confirmButton.value : cancelButton.value)?.focus();
}

function close(returnFocus = true) {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('mousedown', onDocumentMousedown);
  document.removeEventListener('keydown', onDocumentKeydown);
  if (returnFocus) trigger.value?.focus();
}

async function ask() {
  if (block.value !== null) return;
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  document.addEventListener('mousedown', onDocumentMousedown);
  document.addEventListener('keydown', onDocumentKeydown);
  // The safe choice gets the focus: Enter on a confirmation that just opened
  // must not close a conversation.
  await nextTick();
  cancelButton.value?.focus();
}

function onConfirm() {
  close();
  void bridleStore.startNewChat(props.conversation);
}

// The question was asked about a conversation that could be reset. If that
// stops being true while it is open — the agent went away, an answer started —
// it is no longer a question that can be answered "yes".
watch(block, (reason) => {
  if (reason !== null) close(false);
});

// A host that keeps this mounted while the conversation changes under it.
watch(
  () => props.conversation.key,
  () => close(false),
);

onBeforeUnmount(() => close(false));
</script>

<template>
  <!-- Deliberately NOT `relative`: the confirmation anchors to the header
       strip, like the share panel next to it, so it cannot run off a phone's
       edge. -->
  <div ref="root">
    <button
      ref="trigger"
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-describedby="hintId"
      :aria-busy="busy"
      :disabled="block !== null"
      :title="$t(hintKey)"
      @click="ask"
    >
      <Icon
        :name="busy ? 'loader-2' : 'message-square-plus'"
        :size="13"
        :class="busy ? 'animate-spin' : undefined"
      />
      {{ $t('chat.new_chat') }}
    </button>
    <!-- What the button does, or why it cannot: the same sentence the tooltip
         shows, for someone who cannot hover. -->
    <span :id="hintId" class="sr-only">{{ $t(hintKey) }}</span>

    <div
      v-if="open"
      class="absolute right-4 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-card p-3 shadow-md"
      role="dialog"
      aria-modal="true"
      :aria-label="$t('chat.new_chat')"
    >
      <p class="text-xs leading-snug text-foreground">
        {{ $t(confirmKey) }}
      </p>
      <div class="mt-3 flex items-center justify-end gap-1.5">
        <button
          ref="cancelButton"
          type="button"
          class="inline-flex items-center rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition hover:bg-muted"
          @click="close()"
        >
          {{ $t('chat.new_chat_cancel') }}
        </button>
        <button
          ref="confirmButton"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:opacity-90"
          @click="onConfirm"
        >
          <Icon name="message-square-plus" :size="12" />
          {{ $t('chat.new_chat_yes') }}
        </button>
      </div>
    </div>
  </div>
</template>
