<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Textarea } from '#theme/components/ui/textarea'
import { Button } from '#theme/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#theme/components/ui/tooltip'
import { AlertCircle, Paperclip, Send, Wrench } from 'lucide-vue-next'
import { bridleKey, useBridleStore } from '../../stores/bridle'
import AttachmentChip from './AttachmentChip.vue'
import ToolCatalogSheet from '#toolCatalog/components/toolCatalog/Sheet.vue'
import {
  hasPlaceholder,
  insertTemplate,
} from '#toolCatalog/utils/insertTemplate'
import {
  FILE_PICKER_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../../utils/attachment'

const props = defineProps<{
  apiUrl: string
  agentId: string
  channel?: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const store = useBridleStore()

// The composer stages files into ITS conversation — staged files were global
// once, and showed up in every chat that was open.
const conversationKey = computed(() => bridleKey(props.agentId, props.channel))
const staged = computed(() => store.conversations[conversationKey.value]?.staged ?? [])
const attachmentError = computed(
  () => store.conversations[conversationKey.value]?.attachmentError ?? null,
)

const input = ref('')
const textareaRef = ref<InstanceType<typeof Textarea> | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const atLimit = computed(() => staged.value.length >= MAX_ATTACHMENTS_PER_MESSAGE)
const canAttach = computed(() => !props.disabled && !atLimit.value)

/**
 * Sending is allowed with text OR at least one ready attachment, and blocked
 * while anything is still uploading or has failed — an incomplete message
 * would reach the agent missing exactly the file it was about.
 */
const canSend = computed(() => {
  if (props.disabled) return false
  if (store.isUploadingAttachment(conversationKey.value) || store.hasFailedAttachment(conversationKey.value)) return false
  return input.value.trim().length > 0 || store.readyAttachments(conversationKey.value).length > 0
})

const attachTitle = computed(() =>
  atLimit.value
    ? `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files`
    : 'Attach a file',
)

const handleSend = () => {
  if (!canSend.value) return
  emit('send', input.value)
  input.value = ''
  textareaRef.value?.$el?.focus()
}

// ─── Tools panel (CLEAN-109) ─────────────────────────────────────────────
// The sheet lives here, not in the Provider, because the draft does: picking
// a tool must write into `input` and move the caret, and nothing else owns
// those. A template is a starter, not a form — it lands at the caret and the
// person keeps typing.
const toolsOpen = ref(false)

const textareaEl = (): HTMLTextAreaElement | null => {
  const el = textareaRef.value?.$el as HTMLTextAreaElement | undefined
  return el && typeof el.setSelectionRange === 'function' ? el : null
}

const onPickTemplate = (template: string) => {
  const el = textareaEl()
  const cursor = el?.selectionStart ?? input.value.length
  const insertion = insertTemplate(input.value, cursor, template)
  input.value = insertion.text
  toolsOpen.value = false
  void nextTick(() => {
    const target = textareaEl()
    if (!target) return
    target.focus()
    target.setSelectionRange(insertion.selectionStart, insertion.selectionEnd)
  })
}

// A «…» left in the draft is allowed — the agent will ask — but it is shown,
// so nobody sends "Restart the agent «name»" by accident.
const draftHasPlaceholder = computed(() => hasPlaceholder(input.value))

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

const openPicker = () => {
  if (!canAttach.value) return
  fileInputRef.value?.click()
}

const onFilesPicked = (event: Event) => {
  const el = event.target as HTMLInputElement
  if (el.files?.length) {
    store.stageFiles(conversationKey.value, props.apiUrl, el.files)
  }
  // Reset so picking the same file twice in a row still fires `change`.
  el.value = ''
}

/**
 * Pasting a screenshot should behave like any other attachment. Only files are
 * intercepted — pasting text stays plain text, which is what people expect.
 */
const onPaste = (event: ClipboardEvent) => {
  if (!canAttach.value) return
  const files = Array.from(event.clipboardData?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  store.stageFiles(conversationKey.value, props.apiUrl, files)
}
</script>

<template>
  <div class="flex w-full flex-col gap-1.5">
    <!-- Staged files above the composer so it still reads as one block -->
    <div v-if="staged.length" class="flex flex-wrap gap-1.5">
      <AttachmentChip
        v-for="attachment in staged"
        :key="attachment.localId"
        :attachment="attachment"
        @remove="store.removeStaged(conversationKey, $event)"
        @retry="store.retryStaged(conversationKey, apiUrl, $event)"
      />
    </div>

    <div class="flex w-full items-end gap-2">
      <button
        type="button"
        :disabled="!canAttach"
        :aria-label="attachTitle"
        :title="attachTitle"
        class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input bg-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        @click="openPicker"
      >
        <Paperclip class="h-4 w-4" />
      </button>

      <input
        ref="fileInputRef"
        type="file"
        multiple
        class="hidden"
        :accept="FILE_PICKER_ACCEPT"
        @change="onFilesPicked"
      >

      <TooltipProvider :delay-duration="300">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              aria-label="Tools"
              :aria-expanded="toolsOpen"
              class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input bg-transparent text-muted-foreground transition-colors hover:text-foreground"
              :class="toolsOpen ? 'text-foreground' : ''"
              @click="toolsOpen = true"
            >
              <Wrench class="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Tools — what this agent can do, one click to try
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <ToolCatalogSheet
        v-model:open="toolsOpen"
        :agent-id="agentId"
        @pick="onPickTemplate"
      />

      <Textarea
        ref="textareaRef"
        v-model="input"
        :placeholder="placeholder"
        :disabled="disabled"
        class="min-h-[40px] max-h-[120px] resize-none"
        :class="draftHasPlaceholder ? 'ring-1 ring-amber-500/50' : ''"
        :title="draftHasPlaceholder ? 'Fill in the «…» placeholders, or send as is and the agent will ask.' : undefined"
        :rows="1"
        @keydown="handleKeydown"
        @paste="onPaste"
      />

      <Button
        size="icon"
        :disabled="!canSend"
        class="shrink-0 rounded-lg"
        @click="handleSend"
      >
        <Send class="h-4 w-4" />
      </Button>
    </div>

    <!-- Rejections are announced, not just coloured: a screen reader user gets
         no signal from a red line. -->
    <p
      v-if="attachmentError"
      class="flex items-start gap-1.5 text-[11px] text-destructive"
      role="status"
      aria-live="polite"
    >
      <AlertCircle class="mt-px h-3 w-3 shrink-0" />
      <span>{{ attachmentError }}</span>
      <button
        type="button"
        class="ml-1 cursor-pointer underline underline-offset-2 hover:no-underline"
        @click="store.dismissAttachmentError(conversationKey)"
      >
        Dismiss
      </button>
    </p>
  </div>
</template>
