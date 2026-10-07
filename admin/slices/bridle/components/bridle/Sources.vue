<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { BookOpen, Eye, EyeOff, Globe, ThumbsDown, ThumbsUp } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'
import { BridleSourceKinds, type IBridleSourceEntry } from '../../stores/bridle'

/**
 * The list under an answer: what it drew on (CLEAN-138). One entry per
 * citation number; the chips in the text point here. Hidden and shown per
 * message, and only here — the chips stay whatever the list does.
 *
 * A web entry is a link to its page. A knowledge entry opens its document
 * (`open`) when the API says it can, and takes the reader's own rating
 * (`rate`); the parent owns the calls, this draws the state it is given.
 *
 * TWIN: app/slices/bridle/components/bridle/chat/Sources.vue draws the same
 * list in the app console, translated.
 */
const props = defineProps<{
  sources: IBridleSourceEntry[]
  messageId: string
}>()

const emit = defineEmits<{
  /** Open the document behind knowledge source `n`. */
  open: [n: number]
  /** The reader rated knowledge source `n`; `null` takes the rating back. */
  rate: [n: number, rating: 1 | -1 | null]
}>()

const hidden = ref(false)
const activeN = ref<number | null>(null)
let activeTimer: ReturnType<typeof setTimeout> | null = null

/** Several bases in one list: say which one each document belongs to. */
const manyBases = computed(
  () =>
    new Set(
      props.sources
        .filter(s => s.kind === BridleSourceKinds.Knowledge)
        .map(s => s.knowledgeName ?? ''),
    ).size > 1,
)

function entryId(n: number) {
  return `src-${props.messageId}-${n}`
}

/** A chip was activated: show the list if hidden, bring the entry into view, mark it briefly. */
function reveal(n: number) {
  hidden.value = false
  nextTick(() => {
    document.getElementById(entryId(n))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    activeN.value = n
    if (activeTimer) clearTimeout(activeTimer)
    activeTimer = setTimeout(() => (activeN.value = null), 1500)
  })
}

/** Same thumb again takes the rating back; the other one replaces it. */
function onRate(source: IBridleSourceEntry, rating: 1 | -1) {
  emit('rate', source.n, source.myRating === rating ? null : rating)
}

const RATE_BUTTON = 'rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground'

onBeforeUnmount(() => {
  if (activeTimer) clearTimeout(activeTimer)
})

defineExpose({ reveal })
</script>

<template>
  <div class="w-full px-1 text-xs" :data-sources-for="messageId">
    <button
      type="button"
      class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
      :aria-expanded="!hidden"
      :aria-controls="`${entryId(0)}-list`"
      @click="hidden = !hidden"
    >
      <component :is="hidden ? Eye : EyeOff" class="h-3 w-3" />
      {{ hidden ? 'Show sources' : 'Hide sources' }}
    </button>

    <ol
      v-show="!hidden"
      :id="`${entryId(0)}-list`"
      class="mt-1 flex flex-col gap-1"
      aria-label="Sources"
    >
      <li
        v-for="source in sources"
        :id="entryId(source.n)"
        :key="source.n"
        :class="cn(
          'flex min-w-0 items-start gap-1.5 rounded px-1 py-0.5 transition-colors',
          activeN === source.n && 'bg-primary/10',
        )"
        :data-source-kind="source.kind"
      >
        <span class="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{{ source.n }}.</span>
        <component
          :is="source.kind === BridleSourceKinds.Web ? Globe : BookOpen"
          class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
          :aria-label="source.kind === BridleSourceKinds.Web ? 'Web' : 'Knowledge'"
        />
        <span class="min-w-0 flex-1 break-words">
          <!-- A web source opens its page; the title is the page's own. -->
          <a
            v-if="source.kind === BridleSourceKinds.Web && source.url"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline-offset-2 hover:underline"
            :title="`Open ${source.name}`"
          >{{ source.name }}</a>

          <!-- A knowledge document opens through the API when the base allows
               it and the document is still there; otherwise it is just named. -->
          <button
            v-else-if="source.kind === BridleSourceKinds.Knowledge && source.canOpen"
            type="button"
            class="cursor-pointer text-left text-primary underline-offset-2 hover:underline"
            :title="`Open ${source.name}`"
            @click="emit('open', source.n)"
          >{{ source.name }}</button>
          <span
            v-else
            :title="source.kind === BridleSourceKinds.Knowledge ? 'Not available to open' : undefined"
          >{{ source.name }}</span>

          <span
            v-if="source.kind === BridleSourceKinds.Knowledge && manyBases && source.knowledgeName"
            class="text-muted-foreground"
          > · {{ source.knowledgeName }}</span>
        </span>

        <!-- The reader's own verdict on a knowledge document; nothing on a web page. -->
        <span
          v-if="source.kind === BridleSourceKinds.Knowledge"
          class="flex shrink-0 items-center gap-0.5"
        >
          <button
            type="button"
            aria-label="This source helped"
            :aria-pressed="source.myRating === 1"
            :class="cn(RATE_BUTTON, source.myRating === 1 && 'text-green-600')"
            @click="onRate(source, 1)"
          >
            <ThumbsUp class="size-3" />
          </button>
          <button
            type="button"
            aria-label="This source did not help"
            :aria-pressed="source.myRating === -1"
            :class="cn(RATE_BUTTON, source.myRating === -1 && 'text-red-600')"
            @click="onRate(source, -1)"
          >
            <ThumbsDown class="size-3" />
          </button>
        </span>
      </li>
    </ol>
  </div>
</template>
