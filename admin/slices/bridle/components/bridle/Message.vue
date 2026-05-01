<script setup lang="ts">
import { BridlePartTypes, type IBridleMessageData } from '../../stores/bridle'
import { Bot, User, FileText, Info } from 'lucide-vue-next'
import { Button } from '#theme/components/ui/button'
import { cn } from '#theme/utils/cn'

defineProps<{
  message: IBridleMessageData
  hasDebug?: boolean
}>()

defineEmits<{
  inspect: [id: string]
}>()
</script>

<template>
  <div
    :class="cn(
      'flex gap-3 max-w-[85%]',
      message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto',
    )"
  >
    <div
      :class="cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs',
        message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
      )"
    >
      <User v-if="message.role === 'user'" class="h-4 w-4" />
      <Bot v-else class="h-4 w-4" />
    </div>

    <div
      :class="cn(
        'rounded-lg px-3 py-2 text-sm space-y-2',
        message.role === 'user'
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted',
        message.streaming && 'border-l-2 border-primary',
      )"
    >
      <template v-for="(part, i) in message.parts" :key="i">
        <p v-if="part.type === BridlePartTypes.Text" class="whitespace-pre-wrap break-words">{{ part.text }}</p>

        <img
          v-else-if="part.type === BridlePartTypes.Image"
          :src="`data:${part.mediaType};base64,${part.base64}`"
          :alt="`Image ${i + 1}`"
          class="max-w-full rounded"
        />

        <a
          v-else-if="part.type === BridlePartTypes.File"
          :href="part.url"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-2 px-2 py-1 rounded border text-xs hover:bg-background/50"
        >
          <FileText class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">{{ part.name }}</span>
        </a>
      </template>

      <!-- Fallback: if no parts, show plain text -->
      <p v-if="message.parts.length === 0" class="whitespace-pre-wrap break-words">{{ message.text }}</p>
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
</template>
