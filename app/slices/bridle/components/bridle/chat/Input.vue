<script setup lang="ts">
import {
  FILE_PICKER_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '#bridle/domain';
import type { IBridleConversation } from '#bridle/stores/bridle';
import type { ILimitCountdown } from '#bridle/composables/useLimitCountdown';
import { restoredDraft as mergeRestoredDraft } from '#bridle/utils/limit';
import { noticeParams } from '#bridle/utils/noticeParams';
import {
  sharedSessionFromQuery,
  withLinkDraft,
  withoutSharedSession,
} from '#bridle/utils/draftLink';
import { useFormat } from '#common/composables/useFormat';

const props = defineProps<{
  disabled?: boolean;
  conversation: IBridleConversation;
  /**
   * The agent's request limit, counted down by the chat that owns this
   * composer (CLEAN-224); null when there is none. While it is `waiting` the
   * field stays editable and nothing can be sent.
   */
  limit?: ILimitCountdown | null;
  /** The notice's id — what the controls the limit turns off are described by. */
  limitNoticeId?: string;
}>();
const emit = defineEmits<{ send: [text: string] }>();

const bridleStore = useBridleStore();
const format = useFormat();

const draft = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const staged = computed(() => bridleStore.stagedFor(props.conversation.key));
const attachmentError = computed(() =>
  bridleStore.attachmentErrorFor(props.conversation.key),
);

// A message the store could not send because the session ended comes back
// here as a draft (CLEAN-72): put it in the box and consume it, so it is
// offered exactly once and a later remount does not resurrect it. A message
// the agent's limit refused comes back the same way (CLEAN-224) — and by then
// the person may have started the next one, so what is in the field stays,
// below the text that returned.
const restoredDraft = computed(() =>
  bridleStore.draftFor(props.conversation.key),
);
watch(
  restoredDraft,
  (text) => {
    if (!text) return;
    draft.value = mergeRestoredDraft(text, draft.value);
    bridleStore.clearDraft(props.conversation.key);
  },
  { immediate: true },
);

// A link may say a session was just shared with this agent (CLEAN-243): the
// Ranch Cookies extension opens the chat that way after handing it a site's
// cookies. The message is this console's own, in the person's language, from
// the checked profile and site; it goes in the box, caret at the end, and
// never sends itself. The address loses the two so a reload does not put it
// back.
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
onMounted(() => {
  const shared = sharedSessionFromQuery(route.query);
  if (shared === null) return;
  draft.value = withLinkDraft(draft.value, t('chat.shared_session_draft', { ...shared }));
  void router.replace({ query: withoutSharedSession(route.query) });
  void nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
});

// ── Request limit (CLEAN-224) ──────────────────────────────────
// The limit turns sending off and nothing else: the field is never disabled,
// because the wait is a good moment to finish the thought.

const limitWaiting = computed(() => props.limit?.state === 'waiting');
/** Set on the controls the limit turns off, so they say why. */
const limitDescribedBy = computed(() =>
  limitWaiting.value ? props.limitNoticeId : undefined,
);

/** A little longer than the animation it covers (LimitNotice, 360 ms). */
const NUDGE_MS = 400;
const nudging = ref(false);
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Enter, or a press on the Send button, while the limit is full: nothing
 * leaves, and the notice answers so the person sees why. Dropped and set
 * again a frame later, so a second press restarts the animation.
 */
function nudgeLimit() {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudging.value = false;
  requestAnimationFrame(() => {
    nudging.value = true;
    nudgeTimer = setTimeout(() => {
      nudging.value = false;
      nudgeTimer = undefined;
    }, NUDGE_MS);
  });
}

onBeforeUnmount(() => {
  if (nudgeTimer) clearTimeout(nudgeTimer);
});

const atLimit = computed(
  () => staged.value.length >= MAX_ATTACHMENTS_PER_MESSAGE,
);
const canAttach = computed(() => !props.disabled && !atLimit.value);
const canSend = computed(() =>
  bridleStore.canSend(props.conversation.key, draft.value),
);

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
  // Before anything is let go of: the text stays in the field.
  if (limitWaiting.value) {
    nudgeLimit();
    return;
  }
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
  if (input.files?.length) {
    bridleStore.stageFiles(props.conversation, input.files);
  }
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
  bridleStore.stageFiles(props.conversation, files);
}

watch(draft, () => nextTick(autoResize));
</script>

<template>
  <form
    class="shrink-0 border-t bg-background"
    @submit.prevent="submit"
  >
    <div class="mx-auto w-full max-w-3xl px-4 py-3">
      <!-- On the top edge of the field, the same width: where the hand
           already is. It cannot be dismissed — it leaves when the limit does. -->
      <BridleChatLimitNotice
        v-if="limit && limitNoticeId"
        :id="limitNoticeId"
        :countdown="limit"
        :nudge="nudging"
      />
      <div
        class="group flex flex-col gap-2 rounded-2xl border bg-card px-2 py-1.5 shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
        :class="[disabled && 'opacity-60', limit && limitNoticeId && 'rounded-t-none']"
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
            @remove="bridleStore.removeStaged(conversation, $event)"
            @retry="bridleStore.retryStaged(conversation, $event)"
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

          <!-- While the limit is full the button is off for assistive
               technology and to the eye, but not `disabled`: it stays in the
               tab order and says why it is off (CLEAN-224). A press goes to
               `submit`, which sends nothing and nudges the notice. -->
          <button
            type="submit"
            :disabled="!limitWaiting && !canSend"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            :class="limitWaiting
              ? 'cursor-not-allowed bg-muted text-muted-foreground'
              : 'bg-primary text-primary-foreground hover:opacity-90'"
            :aria-label="$t('chat.send')"
            :aria-disabled="limitWaiting ? 'true' : undefined"
            :aria-describedby="limitDescribedBy"
            :title="limitWaiting ? $t('bridle.limit.sendDisabled') : undefined"
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
        <span>{{ $t(attachmentError.key, noticeParams(attachmentError, format.size)) }}</span>
        <button
          type="button"
          class="ml-1 underline underline-offset-2 hover:opacity-80"
          @click="bridleStore.dismissAttachmentError(conversation)"
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
