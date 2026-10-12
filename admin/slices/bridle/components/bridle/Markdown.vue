<script setup lang="ts">
import { computed } from 'vue'
import { citationNumberOf, type CitationModes } from '../../utils/citations'
import { renderMarkdown } from '../../utils/markdown'

/**
 * An agent's markdown, rendered and sanitised (CLEAN-137). The styles come
 * from `chat-md` on the bubble around it (`assets/chat-md.css`); this owns
 * the HTML, the "copy code" button the renderer puts on every block and the
 * citation chips (CLEAN-138): a click or Enter/Space on a chip emits `cite`
 * with its number, and the parent scrolls the sources list to it.
 */
const props = defineProps<{
  text: string
  /** How `[^n]` markers are drawn; absent means `numbered`. See utils/citations.ts. */
  citations?: CitationModes
}>()

const emit = defineEmits<{ cite: [n: number] }>()

const html = computed(() => renderMarkdown(props.text, { citations: props.citations }))

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const n = citationNumberOf(target)
  if (n !== null) {
    emit('cite', n)
    return
  }
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

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const n = citationNumberOf(event.target)
  if (n === null) return
  event.preventDefault()
  emit('cite', n)
}
</script>

<template>
  <div class="min-w-0 wrap-break-word" v-html="html" @click="onClick" @keydown="onKeydown" />
</template>
