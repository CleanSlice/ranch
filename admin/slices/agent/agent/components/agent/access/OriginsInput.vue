<script setup lang="ts">
/**
 * Allowed origins as removable chips with a field to add one (CLEAN-228,
 * research R9). Enter or a comma adds what is typed, × or Backspace in the
 * empty field removes, and `parseOrigin` decides what an origin is: scheme
 * and host, an optional port, no path. A duplicate is not added twice;
 * something that is not an origin stays in the field and the hint says what
 * one looks like.
 *
 * Controlled: the list is the caller's (the page's draft), this component
 * holds only the text being typed.
 */
import { IconX } from '@tabler/icons-vue'
import { parseOrigin } from '#agent/utils/origin'

const props = defineProps<{
  modelValue: string[]
  disabled?: boolean
  /** The list differs from what is saved: the field wears the "changed" ring. */
  changed?: boolean
  id?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [origins: string[]] }>()

const uid = useId()
const inputId = computed(() => props.id ?? `${uid}-origin`)
const hintId = computed(() => `${uid}-origin-hint`)

const text = ref('')
const refused = ref(false)
const input = ref<HTMLInputElement | null>(null)

// Typed or pasted: one origin, or several separated by commas, spaces or
// line breaks. What is an origin is added; the first thing that is not stays
// in the field with the rest behind it, to be corrected.
function add(raw: string): void {
  const parts = raw.split(/[\s,]+/).filter(Boolean)
  if (!parts.length) {
    text.value = ''
    refused.value = false
    return
  }
  const next = [...props.modelValue]
  let left = ''
  for (let i = 0; i < parts.length; i += 1) {
    const parsed = parseOrigin(parts[i]!)
    if (!parsed.ok) {
      left = parts.slice(i).join(' ')
      break
    }
    if (!next.includes(parsed.origin)) next.push(parsed.origin)
  }
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
  text.value = left
  refused.value = left !== ''
}

function remove(origin: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((o) => o !== origin),
  )
  input.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    add(text.value)
    return
  }
  if (event.key === 'Backspace' && text.value === '' && props.modelValue.length) {
    event.preventDefault()
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

function onInput(): void {
  refused.value = false
}

function onPaste(event: ClipboardEvent): void {
  const pasted = event.clipboardData?.getData('text') ?? ''
  // One origin pasted into the field is ordinary typing; a list is added.
  if (!/[\s,]/.test(pasted.trim())) return
  event.preventDefault()
  add(`${text.value}${pasted}`)
}

// Typed and left without Enter: it would otherwise be lost at Save without a
// word.
function onBlur(): void {
  if (text.value.trim()) add(text.value)
}

const hint = computed(() => {
  if (refused.value) {
    return 'Use a full origin such as https://example.com, without a path.'
  }
  return props.modelValue.length
    ? 'Pages on these origins can open the chat without a token.'
    : 'None yet: every origin needs a token. Scheme and host only, no path.'
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <!-- A click anywhere in the box that is not a chip lands in the field. -->
    <div
      class="flex min-h-[34px] min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input px-1.5 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      :class="[
        changed && 'border-amber-500/70 ring-2 ring-amber-500/45',
        refused && 'border-destructive',
        disabled && 'opacity-50',
      ]"
      data-origins
      :data-changed="changed ? '' : undefined"
      @click.self="input?.focus()"
    >
      <span
        v-for="origin in modelValue"
        :key="origin"
        class="inline-flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-0.5 font-mono text-xs"
        :data-origin="origin"
      >
        <span class="min-w-0 break-all">{{ origin }}</span>
        <button
          type="button"
          class="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none"
          :aria-label="`Remove ${origin}`"
          :disabled="disabled"
          @click="remove(origin)"
        >
          <IconX class="size-3.5" aria-hidden="true" />
        </button>
      </span>
      <input
        :id="inputId"
        ref="input"
        v-model="text"
        type="text"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="https://example.com, then Enter"
        class="h-[26px] min-w-[150px] flex-1 bg-transparent px-1 text-[13px] outline-none"
        :disabled="disabled"
        :aria-describedby="hintId"
        :aria-invalid="refused ? 'true' : undefined"
        data-origin-input
        @keydown="onKeydown"
        @input="onInput"
        @paste="onPaste"
        @blur="onBlur"
      />
    </div>
    <p
      :id="hintId"
      class="text-xs"
      :class="refused ? 'text-destructive' : 'text-muted-foreground'"
      :role="refused ? 'alert' : undefined"
      data-origin-hint
    >
      {{ hint }}
    </p>
  </div>
</template>
