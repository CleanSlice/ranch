<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../../utils/markdown'

/**
 * An agent's markdown, rendered and sanitised (CLEAN-137). The styles come
 * from `chat-md` on the bubble around it (`assets/chat-md.css`); this owns
 * the HTML and the "copy code" button the renderer puts on every block.
 */
const props = defineProps<{ text: string }>()

const html = computed(() => renderMarkdown(props.text))

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const btn = target?.closest<HTMLButtonElement>('button[data-action="copy"]')
  if (!btn) return
  const text = btn.parentElement?.querySelector('pre')?.textContent ?? ''
  if (!text) return
  navigator.clipboard
    .writeText(text)
    .then(() => {
      btn.classList.add('copied')
      setTimeout(() => btn.classList.remove('copied'), 1500)
    })
    .catch(() => {})
}
</script>

<template>
  <div class="min-w-0 wrap-break-word" v-html="html" @click="onClick" />
</template>
