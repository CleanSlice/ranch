<script setup lang="ts">
import {
  BridleDeliveryStates,
  BridleRoleTypes,
  useBridleStore,
  type IBridleConversation,
  type IBridleMessage,
} from '#bridle/stores/bridle';
import { failureHintKey } from '#bridle/utils/delivery';
import { citationNumberOf } from '#bridle/utils/citations';
import { renderMarkdown } from '#bridle/utils/markdown';
import { useFormat } from '#common/composables/useFormat';
import BridleChatProposalCard from './ProposalCard.vue';
import BridleChatSources from './Sources.vue';

const props = defineProps<{
  message: IBridleMessage;
  /** Carried through to the attachment list, which reads bytes back. */
  conversation: IBridleConversation;
  agentName?: string;
}>();
const emit = defineEmits<{ resend: [id: string]; discard: [id: string] }>();

const format = useFormat();
// Opening and rating a cited source go through the store, which owns the
// record and the error line under the chat (CLEAN-138).
const store = useBridleStore();

const isUser = computed(() => props.message.role === BridleRoleTypes.User);

// ── Time ───────────────────────────────────────────────────────
// Time of day under the bubble, the whole date-time on hover. The date itself
// is the day separator's job (Provider), so it is not repeated per message.

/** Null for a stored message with a broken `ts` — `toISOString` throws on it,
 *  and one bad record must not take the whole conversation down with it. */
const sentAt = computed(() =>
  Number.isFinite(props.message.ts) ? new Date(props.message.ts) : null,
);
const timeLabel = computed(() => format.clock(props.message.ts));
const timeTitle = computed(() => format.stampTitle(props.message.ts));

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

// Agent messages can contain markdown (lists, headings, code). User messages
// stay plain text — they're typed by humans and we don't want to risk
// accidentally HTML-rendering something they pasted.
//
// Citations (CLEAN-138): while the answer streams the model's `[^n]` numbers
// are not final, so the chips are neutral dots; the final text is already
// renumbered when `stream_end` lands, so chips carry their numbers from then
// on, and the list arrives on the frame that follows.
const renderedHtml = computed(() =>
  isUser.value
    ? null
    : renderMarkdown(props.message.text, {
        citations: props.message.streaming ? 'pending' : 'numbered',
      }),
);

const sourcesList = ref<{ reveal: (n: number) => void } | null>(null);

/** A chip in the text was clicked or activated from the keyboard. */
function onBubbleClick(event: Event) {
  const n = citationNumberOf(event.target);
  if (n !== null) sourcesList.value?.reveal(n);
}
function onBubbleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const n = citationNumberOf(event.target);
  if (n === null) return;
  event.preventDefault();
  sourcesList.value?.reveal(n);
}
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
    <BridleChatAvatar v-if="!isUser" :name="agentName" />

    <!-- The column owns the width cap so the lines under the bubble wrap to
         the bubble's measure instead of running across the whole chat. -->
    <div
      class="flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%]"
      :class="isUser ? 'items-end' : 'items-start'"
    >
      <!-- Dimmed while on its way: not there yet, and looks it — without a
           word for as long as it is quick. -->
      <BridleChatBubble :user="isUser" :dimmed="isSending || isSlow">
        <!-- Media above the text, the way every chat client orders it -->
        <BridleChatAttachmentList
          v-if="message.attachments?.length"
          :attachments="message.attachments"
          :conversation="conversation"
          :on-primary="isUser"
        />
        <template v-if="isUser">{{ message.text }}</template>
        <!-- A file change proposal (CLEAN-112): read-only card in this console. -->
        <BridleChatProposalCard v-else-if="message.proposal" :proposal="message.proposal" />
        <div
          v-else
          @click="onBubbleClick"
          @keydown="onBubbleKeydown"
          v-html="renderedHtml"
        />
      </BridleChatBubble>

      <!-- What the answer drew on (CLEAN-138); absent when it cited nothing. -->
      <BridleChatSources
        v-if="!isUser && message.sources?.length"
        ref="sourcesList"
        :sources="message.sources"
        :message-id="message.id"
        @open="(n) => store.openSource(conversation, message.id, n)"
        @rate="(n, rating) => store.rateSource(conversation, message.id, n, rating)"
      />

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
