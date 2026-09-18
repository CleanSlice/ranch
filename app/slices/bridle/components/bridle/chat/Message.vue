<script setup lang="ts">
import {
  BridleDeliveryStates,
  BridleRoleTypes,
  type IBridleConversation,
  type IBridleMessage,
} from '#bridle/stores/bridle';
import { failureHintKey } from '#bridle/utils/delivery';
import { renderMarkdown } from '#bridle/utils/markdown';

const props = defineProps<{
  message: IBridleMessage;
  /** Carried through to the attachment list, which reads bytes back. */
  conversation: IBridleConversation;
  agentName?: string;
}>();
const emit = defineEmits<{ resend: [id: string]; discard: [id: string] }>();

// The locale itself, for date formatting — the one use of `useI18n()` that
// docs/i18n.md keeps; every string below still goes through `$t`.
const { locale } = useI18n();

const isUser = computed(() => props.message.role === BridleRoleTypes.User);

// ── Time ───────────────────────────────────────────────────────
// Time of day under the bubble, the whole date-time on hover. The date itself
// is the day separator's job (Provider), so it is not repeated per message.

/** Null for a stored message with a broken `ts` — `Intl` throws on NaN, and
 *  one bad record must not take the whole conversation down with it. */
const sentAt = computed(() =>
  Number.isFinite(props.message.ts) ? new Date(props.message.ts) : null,
);
const timeLabel = computed(() =>
  sentAt.value
    ? new Intl.DateTimeFormat(locale.value, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(sentAt.value)
    : '',
);
const timeTitle = computed(() =>
  sentAt.value
    ? new Intl.DateTimeFormat(locale.value, {
        dateStyle: 'long',
        timeStyle: 'medium',
      }).format(sentAt.value)
    : '',
);

// ── Delivery ───────────────────────────────────────────────────
// Only the person's own messages have one, and a delivered message says
// nothing: silence is the normal case, words are for when something is off.

const delivery = computed(() =>
  isUser.value
    ? (props.message.delivery ?? BridleDeliveryStates.Delivered)
    : BridleDeliveryStates.Delivered,
);
const isSending = computed(
  () => delivery.value === BridleDeliveryStates.Sending,
);
const isSlow = computed(() => delivery.value === BridleDeliveryStates.Slow);
const isFailed = computed(() => delivery.value === BridleDeliveryStates.Failed);
/** Copy decided in script travels as a key (docs/i18n.md). */
const failureHint = computed(() => failureHintKey(props.message.failureCode));

const agentInitial = computed(() => {
  const source = props.agentName?.trim() || 'Agent';
  const first = source.split(/\s+/).filter(Boolean)[0]?.[0];
  return first?.toUpperCase() ?? 'A';
});

// Agent messages can contain markdown (lists, headings, code). User messages
// stay plain text — they're typed by humans and we don't want to risk
// accidentally HTML-rendering something they pasted.
const renderedHtml = computed(() =>
  isUser.value ? null : renderMarkdown(props.message.text),
);
</script>

<template>
  <!-- data-* are hooks for browser checks: which message, whose, in what state. -->
  <div
    class="flex items-start gap-2"
    :class="isUser ? 'justify-end' : 'justify-start'"
    :data-message-id="message.id"
    :data-role="message.role"
    :data-delivery="delivery"
  >
    <div
      v-if="!isUser"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary/25 to-primary/5 text-[11px] font-semibold text-primary"
      :title="agentName"
    >
      {{ agentInitial }}
    </div>

    <!-- The column owns the width cap so the lines under the bubble wrap to
         the bubble's measure instead of running across the whole chat. -->
    <div
      class="flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%]"
      :class="isUser ? 'items-end' : 'items-start'"
    >
      <!-- Dimmed while on its way: not there yet, and looks it — without a
           word for as long as it is quick. -->
      <div
        class="max-w-full wrap-break-word px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-opacity"
        :class="[
          isUser
            ? 'whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary text-primary-foreground'
            : 'chat-md rounded-2xl rounded-tl-md bg-muted text-foreground',
          (isSending || isSlow) && 'opacity-70',
        ]"
      >
        <!-- Media above the text, the way every chat client orders it -->
        <BridleChatAttachmentList
          v-if="message.attachments?.length"
          :attachments="message.attachments"
          :conversation="conversation"
          :on-primary="isUser"
        />
        <template v-if="isUser">{{ message.text }}</template>
        <div v-else v-html="renderedHtml" />
      </div>

      <div
        class="flex flex-wrap items-center gap-x-1.5 px-1 text-[11px] text-muted-foreground"
        :class="isUser && 'justify-end'"
      >
        <span
          v-if="isSlow"
          class="flex items-center gap-1"
          role="status"
        >
          <Icon name="loader-2" :size="11" class="animate-spin" />
          {{ $t('chat.delivery_slow') }}
        </span>
        <span v-else-if="isSending" class="sr-only" role="status">
          {{ $t('chat.delivery_sending') }}
        </span>
        <span
          v-else-if="isFailed"
          class="flex items-center gap-1 font-medium text-destructive"
        >
          <Icon name="alert-circle" :size="11" />
          {{ $t('chat.not_delivered') }}
        </span>
        <time v-if="sentAt" :datetime="sentAt.toISOString()" :title="timeTitle">
          {{ timeLabel }}
        </time>
      </div>

      <!-- Announced, not just coloured — and the way out sits right under
           the explanation: nothing here needs the message to be retyped. -->
      <div
        v-if="isFailed"
        class="flex flex-col items-end gap-1 px-1 text-right text-[11px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <p>{{ $t(failureHint) }}</p>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="font-medium text-foreground underline underline-offset-2 hover:opacity-80"
            @click="emit('resend', message.id)"
          >
            {{ $t('chat.resend') }}
          </button>
          <button
            type="button"
            class="underline underline-offset-2 hover:opacity-80"
            @click="emit('discard', message.id)"
          >
            {{ $t('chat.discard') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/**
 * Markdown content rendered inside an agent bubble. Kept tight so headings,
 * lists, and code blocks read as part of the conversation rather than a
 * full article. Global (un-scoped) so v-html children pick it up.
 */
.chat-md > *:first-child {
  margin-top: 0;
}
.chat-md > *:last-child {
  margin-bottom: 0;
}

.chat-md p {
  margin: 0.4em 0;
}
.chat-md p:empty {
  display: none;
}

.chat-md strong {
  font-weight: 600;
}
.chat-md em {
  font-style: italic;
}

.chat-md a {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-md a:hover {
  opacity: 0.85;
}

.chat-md ul,
.chat-md ol {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.chat-md ul {
  list-style: disc;
}
.chat-md ol {
  list-style: decimal;
}
.chat-md li {
  margin: 0.2em 0;
}
.chat-md li > p {
  margin: 0;
}
.chat-md li::marker {
  color: var(--color-muted-foreground);
}

.chat-md h1,
.chat-md h2,
.chat-md h3,
.chat-md h4,
.chat-md h5,
.chat-md h6 {
  font-weight: 600;
  line-height: 1.3;
  margin: 0.8em 0 0.3em;
}
.chat-md h1 {
  font-size: 1.15em;
}
.chat-md h2 {
  font-size: 1.05em;
}
.chat-md h3,
.chat-md h4,
.chat-md h5,
.chat-md h6 {
  font-size: 1em;
}

.chat-md code {
  background-color: color-mix(in srgb, currentColor 10%, transparent);
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 0.9em;
}

.chat-md pre {
  background-color: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 0.5rem;
  padding: 0.75em 0.9em;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.85em;
  line-height: 1.5;
}
.chat-md pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

.chat-md blockquote {
  border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  padding-left: 0.9em;
  margin: 0.5em 0;
  color: var(--color-muted-foreground);
  font-style: italic;
}

.chat-md hr {
  border: 0;
  border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  margin: 0.8em 0;
}

.chat-md table {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.9em;
  width: 100%;
}
.chat-md th,
.chat-md td {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  padding: 0.35em 0.6em;
  text-align: left;
}
.chat-md th {
  font-weight: 600;
  background-color: color-mix(in srgb, currentColor 6%, transparent);
}
</style>
