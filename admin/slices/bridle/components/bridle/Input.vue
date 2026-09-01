<script setup lang="ts">
import { computed, ref } from 'vue'
import { Textarea } from '#theme/components/ui/textarea'
import { Button } from '#theme/components/ui/button'
import { AlertCircle, Paperclip, Send } from 'lucide-vue-next'
import { useBridleStore } from '../../stores/bridle'
import AttachmentChip from './AttachmentChip.vue'
import {
  FILE_PICKER_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../../utils/attachment'

const props = defineProps<{
  apiUrl: string
  agentId: string
  token: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const store = useBridleStore()

const input = ref('')
const textareaRef = ref<InstanceType<typeof Textarea> | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const atLimit = computed(() => store.staged.length >= MAX_ATTACHMENTS_PER_MESSAGE)
const canAttach = computed(() => !props.disabled && !atLimit.value)

/**
 * Sending is allowed with text OR at least one ready attachment, and blocked
 * while anything is still uploading or has failed — an incomplete message
 * would reach the agent missing exactly the file it was about.
 */
const canSend = computed(() => {
  if (props.disabled) return false
  if (store.isUploadingAttachment || store.hasFailedAttachment) return false
  return input.value.trim().length > 0 || store.readyAttachments.length > 0
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
    store.stageFiles(props.apiUrl, props.agentId, props.token, el.files)
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
  store.stageFiles(props.apiUrl, props.agentId, props.token, files)
}
</script>

<template>
  <div class="flex w-full flex-col gap-1.5">
    <!-- Staged files above the composer so it still reads as one block -->
    <div v-if="store.staged.length" class="flex flex-wrap gap-1.5">
      <AttachmentChip
        v-for="attachment in store.staged"
        :key="attachment.localId"
        :attachment="attachment"
        @remove="store.removeStaged($event)"
        @retry="store.retryStaged(apiUrl, agentId, token, $event)"
      />
    </div>

    <div class="flex w-full items-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="shrink-0"
        :disabled="!canAttach"
        :aria-label="attachTitle"
        :title="attachTitle"
        @click="openPicker"
      >
        <Paperclip class="h-4 w-4" />
      </Button>

      <input
        ref="fileInputRef"
        type="file"
        multiple
        class="hidden"
        :accept="FILE_PICKER_ACCEPT"
        @change="onFilesPicked"
      >

      <Textarea
        ref="textareaRef"
        v-model="input"
        :placeholder="placeholder"
        :disabled="disabled"
        class="min-h-[40px] max-h-[120px] resize-none"
        :rows="1"
        @keydown="handleKeydown"
        @paste="onPaste"
      />

      <Button
        size="icon"
        :disabled="!canSend"
        class="shrink-0"
        @click="handleSend"
      >
        <Send class="h-4 w-4" />
      </Button>
    </div>

    <!-- Rejections are announced, not just coloured: a screen reader user gets
         no signal from a red line. -->
    <p
      v-if="store.attachmentError"
      class="flex items-start gap-1.5 text-[11px] text-destructive"
      role="status"
      aria-live="polite"
    >
      <AlertCircle class="mt-px h-3 w-3 shrink-0" />
      <span>{{ store.attachmentError }}</span>
      <button
        type="button"
        class="ml-1 cursor-pointer underline underline-offset-2 hover:no-underline"
        @click="store.dismissAttachmentError()"
      >
        Dismiss
      </button>
    </p>
  </div>
</template>
