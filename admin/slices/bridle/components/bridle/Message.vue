<script setup lang="ts">
import { computed, ref, onBeforeUnmount, watch } from 'vue'
import { BridlePartTypes, type IBridleMessageData } from '../../stores/bridle'
import { renderMarkdown } from '../../utils/markdown'
import ProposalCard from './ProposalCard.vue'
import { AlertCircle, Bot, User, FileText, Info, Loader2, X } from 'lucide-vue-next'
import { Button } from '#theme/components/ui/button'
import { cn } from '#theme/utils/cn'

const props = defineProps<{
  message: IBridleMessageData
  hasDebug?: boolean
  markdownEnabled?: boolean
  /** DEBUG toggle state: gates the "what the agent received" disclosure. */
  debugEnabled?: boolean
}>()

// A replayed user turn with attachments carries the full model-facing text.
// It is only worth showing to someone debugging the prompt, so the
// disclosure follows the DEBUG toggle and starts collapsed.
const agentTextOpen = ref(false)
const showAgentText = computed(
  () => isUser.value && !!props.debugEnabled && !!props.message.agentText,
)

defineEmits<{
  inspect: [id: string]
  resend: [id: string]
  discard: [id: string]
  /** A proposal card was applied — the provider posts the follow-up line. */
  proposalApplied: [text: string]
}>()

const isUser = computed(() => props.message.role === 'user')

// ── Time and delivery line ───────────────────────────────────
// The admin panel is English-only, hence the fixed locale. Built once per
// bubble, not per render — constructing a formatter is the expensive part.
const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' })

// `format` throws on an invalid date; a message with a broken `ts` should
// lose its time line, not take the whole chat down.
const hasTime = computed(() => Number.isFinite(props.message.ts))
const timeOfDay = computed(() => (hasTime.value ? timeFormat.format(props.message.ts) : ''))
const fullDateTime = computed(() => (hasTime.value ? dateTimeFormat.format(props.message.ts) : ''))
const isoDateTime = computed(() => (hasTime.value ? new Date(props.message.ts).toISOString() : undefined))

// Only the operator's own messages have a delivery state; absent means
// delivered (anything replayed from the transcript).
const delivery = computed(() => (isUser.value ? props.message.delivery ?? 'delivered' : 'delivered'))

/** Short, plain reason next to "Not delivered" — one per failure code. */
const failureReason = computed(() => {
  switch (props.message.failureCode) {
    case 'AGENT_OFFLINE':
      return 'the agent is offline'
    case 'OFFLINE':
      return 'the chat is not connected'
    case 'TIMEOUT':
      return 'no confirmation from the server'
    case 'ATTACHMENT_FAILED':
      return 'an attachment could not be read'
    default:
      return 'the server rejected it'
  }
})

// Markdown rendering applies only to assistant messages — user input stays
// plain text so pasted content can't accidentally be rendered as HTML.
function htmlFor(text: string): string {
  return renderMarkdown(text)
}

function onMarkdownClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const btn = target?.closest<HTMLButtonElement>('button[data-action="copy"]')
  if (!btn) return
  const pre = btn.parentElement?.querySelector('pre')
  const text = pre?.textContent ?? ''
  if (!text) return
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied')
    setTimeout(() => btn.classList.remove('copied'), 1500)
  }).catch(() => {})
}

// ── Fullscreen image preview ─────────────────────────────────
// Click on a chat image → opens a Teleport'd overlay with the image at
// max viewport size. Backdrop click or Escape closes. No shadcn Dialog
// because it isn't installed in this theme; a 20-line lightbox covers it.
const lightboxSrc = ref<string | null>(null)

function openLightbox(src: string): void {
  lightboxSrc.value = src
}

function closeLightbox(): void {
  lightboxSrc.value = null
}

function onLightboxKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeLightbox()
}

watch(lightboxSrc, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('keydown', onLightboxKey)
    // Prevent page scroll while the lightbox is up.
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onLightboxKey)
    document.body.style.overflow = ''
  }
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onLightboxKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <!-- data-* are hooks for browser checks: which message, whose, in what state. -->
  <div
    :data-message-id="message.id"
    :data-role="message.role"
    :data-delivery="delivery"
    :class="cn(
      'flex gap-3 max-w-[85%]',
      isUser ? 'ml-auto flex-row-reverse' : 'mr-auto',
    )"
  >
    <div
      :class="cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
      )"
    >
      <User v-if="isUser" class="h-4 w-4" />
      <Bot v-else class="h-4 w-4" />
    </div>

    <!-- Bubble + the line under it (time, delivery state) as one column, so
         the line hugs the bubble's own edge on either side of the chat. -->
    <div :class="cn('flex min-w-0 flex-col gap-1', isUser ? 'items-end' : 'items-start')">
      <div
        :class="cn(
          'min-w-0 rounded-lg px-3 py-2 text-sm space-y-2',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
          !isUser && markdownEnabled && 'chat-md',
          message.streaming && 'border-l-2 border-primary',
        )"
      >
        <template v-for="(part, i) in message.parts" :key="i">
          <template v-if="part.type === BridlePartTypes.Text">
            <div
              v-if="!isUser && markdownEnabled"
              class="min-w-0 wrap-break-word"
              v-html="htmlFor(part.text)"
              @click="onMarkdownClick"
            />
            <p v-else class="whitespace-pre-wrap wrap-break-word">{{ part.text }}</p>
          </template>

          <img
            v-else-if="part.type === BridlePartTypes.Image"
            :src="`data:${part.mediaType};base64,${part.base64}`"
            :alt="`Image ${i + 1}`"
            class="max-w-full cursor-zoom-in rounded transition-opacity hover:opacity-90"
            @click="openLightbox(`data:${part.mediaType};base64,${part.base64}`)"
          />

          <!-- A file change proposal (CLEAN-112): the card renders by id. -->
          <ProposalCard
            v-else-if="part.type === BridlePartTypes.Proposal"
            :proposal-id="part.proposalId"
            @applied="(text) => $emit('proposalApplied', text)"
          />

          <!-- An url-less chip is a replayed attachment whose stored object is
               gone — still named, no longer clickable. -->
          <component
            :is="part.url ? 'a' : 'div'"
            v-else-if="part.type === BridlePartTypes.File"
            :href="part.url || undefined"
            :target="part.url ? '_blank' : undefined"
            :rel="part.url ? 'noopener' : undefined"
            :title="part.url ? part.name : 'Attachment is no longer available'"
            class="flex items-center gap-2 px-2 py-1 rounded border text-xs"
            :class="part.url ? 'hover:bg-background/50' : 'opacity-60'"
          >
            <FileText class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ part.name }}</span>
          </component>
        </template>

        <!-- Fallback: if no parts, show plain text (or markdown for assistant) -->
        <template v-if="message.parts.length === 0 && !showAgentText">
          <div
            v-if="!isUser && markdownEnabled"
            class="min-w-0 wrap-break-word"
            v-html="htmlFor(message.text)"
            @click="onMarkdownClick"
          />
          <p v-else class="whitespace-pre-wrap wrap-break-word">{{ message.text }}</p>
        </template>

        <!-- What the agent received: typed text + inlined attachment blocks.
             Debug-only, collapsed by default — the bubble above is the message. -->
        <div v-if="showAgentText" class="border-t border-primary-foreground/20 pt-1.5">
          <button
            type="button"
            class="flex items-center gap-1 text-[11px] opacity-80 hover:opacity-100"
            @click="agentTextOpen = !agentTextOpen"
          >
            <Info class="h-3 w-3" />
            <span>{{ agentTextOpen ? 'Hide what the agent received' : 'What the agent received' }}</span>
          </button>
          <pre
            v-if="agentTextOpen"
            class="mt-1.5 max-h-[40vh] overflow-auto rounded bg-background/20 p-2 text-[11px] leading-snug whitespace-pre-wrap wrap-break-word"
          >{{ message.agentText }}</pre>
        </div>
      </div>

      <div
        v-if="hasTime || delivery !== 'delivered'"
        class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10px] text-muted-foreground"
        :class="isUser && 'justify-end'"
      >
        <time v-if="hasTime" :datetime="isoDateTime" :title="fullDateTime">{{ timeOfDay }}</time>

        <!-- Delivered says nothing: the time alone is the normal case. -->
        <span v-if="delivery === 'sending'" class="opacity-70" role="status">Sending…</span>

        <span v-else-if="delivery === 'slow'" class="flex items-center gap-1" role="status">
          <Loader2 class="h-3 w-3 animate-spin" />
          Taking longer than usual…
        </span>

        <!-- Announced, not just coloured: this is the one state the person
             has to act on, or the message is gone. -->
        <template v-else-if="delivery === 'failed'">
          <span class="flex items-center gap-1 text-destructive" role="alert">
            <AlertCircle class="h-3 w-3 shrink-0" />
            Not delivered — {{ failureReason }}
          </span>
          <button
            type="button"
            class="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:no-underline"
            @click="$emit('resend', message.id)"
          >
            Resend
          </button>
          <button
            type="button"
            class="cursor-pointer underline underline-offset-2 hover:no-underline"
            @click="$emit('discard', message.id)"
          >
            Discard
          </button>
        </template>
      </div>
    </div>

    <Button
      v-if="message.role === 'assistant' && hasDebug"
      variant="ghost"
      size="icon"
      class="h-6 w-6 self-end mb-1 text-muted-foreground hover:text-foreground"
      title="Inspect prompt"
      @click="$emit('inspect', message.id)"
    >
      <Info class="h-3.5 w-3.5" />
    </Button>
  </div>

  <!-- Fullscreen image preview. Teleport'd to <body> so it escapes any
       overflow/transform on ancestor chat containers and covers the whole
       viewport. Backdrop click or Escape closes. -->
  <Teleport to="body">
    <div
      v-if="lightboxSrc"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 cursor-zoom-out"
      role="dialog"
      aria-modal="true"
      @click.self="closeLightbox"
    >
      <img
        :src="lightboxSrc"
        alt="Fullscreen preview"
        class="max-h-full max-w-full rounded shadow-2xl"
        @click.stop
      />
      <button
        type="button"
        class="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        title="Close (Esc)"
        @click="closeLightbox"
      >
        <X class="h-5 w-5" />
      </button>
    </div>
  </Teleport>
</template>
