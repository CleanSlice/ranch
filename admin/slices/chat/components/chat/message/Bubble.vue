<script setup lang="ts">
import BridleAvatar from '#bridle/components/bridle/Avatar.vue';
import BridleBubble from '#bridle/components/bridle/Bubble.vue';
import BridleMarkdown from '#bridle/components/bridle/Markdown.vue';
import { formatBytes } from '#bridle/utils/attachment';
import { FileText, Paperclip, ThumbsUp, ThumbsDown } from 'lucide-vue-next';
import type { IChatMessage } from '#chat/stores/chat';
import { formatMessageTime, type IToolEvent } from '#chat/utils/transcript';

// Read-only transcript message in the redesigned feed. Tool events arrive
// pre-grouped (see groupTranscript) and render as collapsible rows attached
// above the assistant reply they belong to.
//
// The avatar, the bubble and the markdown are Bridle's own components
// (CLEAN-137): a message in the history is the same message the live chat
// showed, so it is drawn by the same code. What this file adds is what only
// the history has — the dated time, the rating and the copy action.
// `rating` is the current user's 👍/👎 on this message (1 | -1 | null).
const props = defineProps<{
  message: IChatMessage;
  tools?: IToolEvent[];
  rating?: number | null;
}>();
const emit = defineEmits<{ rate: [rating: 1 | -1] }>();

const role = computed(() => props.message.role);
const isUser = computed(() => role.value === 'user');
const time = computed(() => formatMessageTime(props.message.ts));

const summaryOpen = ref(false);
// Compaction stores the archive wrapped in [ARCHIVED CONTEXT …] markers — strip
// them for display; the plain gist is what the reader wants.
const summaryText = computed(() =>
  props.message.text
    .replace(/^\[ARCHIVED CONTEXT[^\]]*\]\s*/i, '')
    .replace(/\s*\[END ARCHIVED CONTEXT\]\s*$/i, '')
    .trim(),
);

const copied = ref(false);
function onCopy() {
  navigator.clipboard
    .writeText(props.message.text)
    .then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    })
    .catch(() => {});
}
</script>

<template>
  <!-- Summary marker: compaction folded older turns into a gist -->
  <div v-if="role === 'summary'" class="my-1 flex justify-center">
    <div class="w-full rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-sm">
      <button
        type="button"
        class="flex w-full items-center gap-2 text-left text-muted-foreground"
        @click="summaryOpen = !summaryOpen"
      >
        <FileText class="size-3.5 shrink-0" />
        <span class="font-medium">Earlier in this conversation — summarized</span>
        <span class="ml-auto text-xs">{{ summaryOpen ? 'Hide' : 'Show' }}</span>
      </button>
      <p v-if="summaryOpen" class="mt-2 whitespace-pre-wrap text-muted-foreground">
        {{ summaryText }}
      </p>
    </div>
  </div>

  <!-- System note -->
  <div v-else-if="role === 'system'" class="my-1 text-center text-xs text-muted-foreground">
    {{ message.text }}
  </div>

  <!-- User message: the live chat's row, mirrored to the right. Files the
       person sent are named above the text; their contents never render here. -->
  <div v-else-if="isUser" class="ml-auto flex max-w-[85%] flex-row-reverse gap-3">
    <BridleAvatar user />
    <div class="flex min-w-0 flex-col items-end gap-1">
      <BridleBubble user>
        <div v-if="message.attachments?.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="file in message.attachments"
            :key="file.id"
            :title="`${file.name} · ${formatBytes(file.size)}`"
            class="inline-flex max-w-full items-center gap-1 rounded border border-primary-foreground/30 px-1.5 py-0.5 text-xs"
          >
            <Paperclip class="size-3 shrink-0" />
            <span class="truncate">{{ file.name }}</span>
          </span>
        </div>
        <p v-if="message.text" class="whitespace-pre-wrap wrap-break-word">{{ message.text }}</p>
      </BridleBubble>
      <span class="px-1 text-[10px] text-muted-foreground">{{ time }}</span>
    </div>
  </div>

  <!-- Assistant: avatar, attached tool rows, the bubble, actions row -->
  <div v-else class="mr-auto flex max-w-[85%] gap-3">
    <BridleAvatar />
    <div class="flex min-w-0 flex-col items-start gap-1">
      <ChatMessageToolEvents v-if="tools?.length" :tools="tools" />

      <BridleBubble markdown>
        <BridleMarkdown :text="message.text" />
      </BridleBubble>

      <div class="flex items-center gap-2 px-1">
        <span class="text-[10px] text-muted-foreground">{{ time }}</span>
        <button
          type="button"
          aria-label="Helpful"
          :class="
            cn(
              'rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground',
              rating === 1 && 'text-green-600',
            )
          "
          @click="emit('rate', 1)"
        >
          <ThumbsUp class="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          :class="
            cn(
              'rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground',
              rating === -1 && 'text-red-600',
            )
          "
          @click="emit('rate', -1)"
        >
          <ThumbsDown class="size-3.5" />
        </button>
        <button
          type="button"
          class="text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
          @click="onCopy"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>
  </div>
</template>
